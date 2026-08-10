// Canvas renderer — VORTEX projection.
//
// The field is a disc seen at a tilt, not a polygon seen head-on. Everything the
// simulation produces in (radius, angle) is squashed vertically and given height, so
// walls read as slabs standing on a receding floor rather than as concentric rings.
//
// Two rules shaped this file:
//
// 1. THE TILT IS AXONOMETRIC, NOT PERSPECTIVE. A true perspective divide would shrink
//    the far lanes more than the near ones, so the same pattern would be harder to
//    read at the top of the screen than the bottom. A uniform vertical squash tilts
//    the picture without ever making one lane less legible than another.
//
// 2. SLABS EXTRUDE AWAY FROM THE VIEWER, and walls are drawn outermost-first. Those
//    two facts together make painter ordering correct everywhere on screen without
//    a depth sort: a nearer (inner) wall is always drawn later, and no slab body ever
//    reaches across a wall in front of it.
//
// Still no shadowBlur, no per-frame gradients, no filters.

import { TAU, clamp } from "../core/mathx.js";
import { CORE_R, PLAYER_R, PULSE_MAX_CHARGE, PLAYER_HALF_W } from "../game/constants.js";
import { blitGlow, getVignette } from "./sprites.js";

const PARTICLE_MAX = 260;

/* ------------------------------------------------------------------ camera --
 *
 * The tilt is no longer a constant. It opens as the run gets harder, so the first
 * bars read as a clean flat disc and the drop reads as a canyon you are falling
 * into. `squash` is the vertical foreshortening of the field plane and is simply
 * cos(tilt): 1.0 is dead head-on (pure 2D), and TILT_MAX is the deepest lean.
 *
 * Three rules keep a moving camera from becoming a legibility problem:
 *
 *  - It stays AXONOMETRIC. No perspective divide, so a gap on the far side is
 *    exactly as wide as the same gap near the player, at every tilt.
 *  - Leaning IN is fast, leaning OUT is slow. Difficulty arriving should feel like
 *    the floor dropping away; difficulty passing should feel like relief — not like
 *    the camera snapping back and stealing the read on the next wall.
 *  - Nothing here touches the simulation. Tilt, zoom and roll kicks are read-only
 *    decorations over a world that still runs at a fixed 240 Hz.
 */
const TILT_MIN = 7 * Math.PI / 180;   // effectively flat: the calm opening bars
const TILT_MAX = 45 * Math.PI / 180;  // the deepest the field is ever allowed to lean
const SQUASH_FLAT = Math.cos(TILT_MIN);

/** How much of a slab's height survives projection to screen. */
const H_PROJ = 0.82;
/** Slab height at the cursor's orbit, in field units, at full tilt. */
const WALL_H = 0.15;
/** Beyond this radius slabs lie flat; inside it they stand up as they close in. */
const RISE_R = 1.05;

const DUST_COUNT = 90;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // No `desynchronized`: the latency win is marginal and it makes the backing
    // store unreadable, which costs us pixel-level verification during development.
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.quality = 2; // 2 high, 1 medium, 0 low
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // Camera. `tilt` is the live lean; everything else is a decaying impulse that
    // rides on top of it so hits, beats and section changes have physical weight.
    this.tilt = TILT_MIN;
    this.squash = SQUASH_FLAT;
    this.zoom = 1;
    this.tiltKick = 0;   // extra lean, decays
    this.zoomKick = 0;   // dolly punch, decays
    this.rollKick = 0;   // roll impulse layered over the world's camRot
    this.rollVel = 0;
    this.beatWob = 0;    // breathing on the beat
    this.horizonGlow = 0;

    this.px = new Float32Array(PARTICLE_MAX);
    this.py = new Float32Array(PARTICLE_MAX);
    this.pvx = new Float32Array(PARTICLE_MAX);
    this.pvy = new Float32Array(PARTICLE_MAX);
    this.plife = new Float32Array(PARTICLE_MAX);
    this.pmax = new Float32Array(PARTICLE_MAX);
    this.psize = new Float32Array(PARTICLE_MAX);
    this.pcolor = new Array(PARTICLE_MAX).fill("#fff");
    this.phead = 0;

    // Dust motes live in field space so they inherit the tilt and the camera spin.
    this.dustR = new Float32Array(DUST_COUNT);
    this.dustA = new Float32Array(DUST_COUNT);
    this.dustS = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) this._seedDust(i, true);

    this.beatRings = [];
    this.resize();
  }

  _seedDust(i, spread) {
    this.dustR[i] = spread ? 0.15 + Math.random() * 1.8 : 1.7 + Math.random() * 0.4;
    this.dustA[i] = Math.random() * TAU;
    this.dustS[i] = 0.1 + Math.random() * 0.28;
  }

  resize() {
    const maxDpr = this.quality >= 2 ? 2 : this.quality >= 1 ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.cx = w / 2;
    // Sit the arena slightly below centre so the tall, empty far side reads as sky
    // rather than as wasted space.
    this.cy = h * 0.55;

    this._fitScale();

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._vignette = getVignette(w, h);
  }

  /**
   * Fit the ellipse to whichever axis is tighter. Both terms are "field units I want
   * visible", so no viewport can quietly starve the player of warning time.
   *
   * The height term uses the CURRENT squash, which is what turns the tilt into a free
   * dolly: leaning the field over makes it shorter on screen, so the same fit rule
   * hands the extra room straight back as size. The width term caps it, so the disc
   * grows into the frame and never past it.
   */
  _fitScale() {
    const byWidth = (this.w / 2) / 0.58;
    const byHeight = (this.h * 0.55) / (0.95 * Math.max(this.squash, 0.6));
    this.scale = Math.min(byWidth, byHeight) * this.zoom;
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* particles (screen space)                                           */

  spawnParticle(x, y, vx, vy, life, size, color) {
    const i = this.phead;
    this.phead = (this.phead + 1) % PARTICLE_MAX;
    this.px[i] = x; this.py[i] = y;
    this.pvx[i] = vx; this.pvy[i] = vy;
    this.plife[i] = life; this.pmax[i] = life;
    this.psize[i] = size; this.pcolor[i] = color;
  }

  burst(x, y, count, speed, color, { size = 9, life = 0.5, spread = TAU, dir = 0 } = {}) {
    const n = this.quality >= 2 ? count : this.quality >= 1 ? Math.ceil(count * 0.6) : Math.ceil(count * 0.3);
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.45 + Math.random() * 0.8);
      // Squash the spray too, so debris travels along the floor plane.
      this.spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s * this.squash,
        life * (0.65 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), color);
    }
  }

  addBeatRing(strength, color) {
    if (this.reducedMotion) return;
    if (this.beatRings.length > 6) this.beatRings.shift();
    this.beatRings.push({ r: CORE_R * 0.9, life: 1, strength, color });
  }

  /* ------------------------------------------------------------------ */
  /* camera impulses — called from the event pump in main.js               */

  /** A section boundary: the biggest move the camera ever makes on its own. */
  sectionSwing(strength = 1) {
    if (this.reducedMotion) return;
    this.tiltKick += 0.10 * strength;
    this.zoomKick += 0.085 * strength;
    // Alternate the roll direction so consecutive sections do not all whip the same
    // way — repeated identical motion stops registering after about three of them.
    this.rollVel += (this._swingSign = -(this._swingSign || 1)) * 1.15 * strength;
    this.horizonGlow = Math.min(1.4, this.horizonGlow + 0.9 * strength);
  }

  /** The quarter-note breath. Small on purpose — it plays under everything else. */
  beatPulse(strength = 1) {
    if (this.reducedMotion) return;
    this.beatWob = Math.min(1, this.beatWob + 0.55 * strength);
  }

  /** A pulse or a big hit: a short shove toward the deep angle. */
  impact(strength = 1) {
    if (this.reducedMotion) return;
    this.tiltKick += 0.055 * strength;
    this.zoomKick += 0.05 * strength;
  }

  /**
   * How hard the game is being right now, as 0..1. This is what the tilt tracks.
   *
   * Wall speed dominates, because speed is what the player actually feels; side count
   * and ring rotation contribute because both narrow the read. Progress and heat are
   * folded in by the caller so the field keeps opening up across a run even inside a
   * single section — a track that ended at the same angle it started would waste the
   * whole effect.
   */
  _sectionLoad(world) {
    const s = world.section;
    if (!s) return 0;
    const bySpeed = clamp((s.speed - 0.95) / (1.95 - 0.95), 0, 1);
    const bySides = clamp((s.sides - 4) / 5, 0, 1);
    const byRot = clamp(Math.abs(s.rot ?? 0) / 0.9, 0, 1);
    return clamp(bySpeed * 0.62 + bySides * 0.16 + byRot * 0.22, 0, 1);
  }

  /**
   * Advance tilt, zoom and roll. Runs once per frame on `dt`, never on the sim tick,
   * and reads the world without writing to it.
   */
  _updateCamera(world, dt) {
    const d = Math.min(dt, 0.05);

    if (this.reducedMotion) {
      // Still tilted — the projection IS the game's look — but fixed, so nothing
      // moves under a player who asked for less motion.
      this.tilt = TILT_MIN + (TILT_MAX - TILT_MIN) * 0.55;
      this.shownTilt = this.tilt;
      this.squash = Math.cos(this.tilt);
      this.zoom = 1;
      this.roll = world.camRot;
      this._fitScale();
      return;
    }

    const live = world.status === "running" || world.status === "cleared";
    const prog = clamp(world.progress ?? 0, 0, 1);
    const heat01 = clamp((world.heat - 1) / 7, 0, 1);
    // Weighted so the section is the loudest voice, progress guarantees a long arc
    // across the whole track, and heat lets a player on a streak pull the camera
    // further over than the chart alone would.
    const load = live
      ? clamp(this._sectionLoad(world) * 0.54 + prog * 0.30 + heat01 * 0.16, 0, 1)
      : 0;
    // Ease so the middle of the range is not a flat ramp — most of the visible change
    // lands where the chart actually gets hard.
    const eased = load * load * (3 - 2 * load);

    this.beatWob *= Math.exp(-d * 6.5);
    this.tiltKick *= Math.exp(-d * 3.2);
    this.zoomKick *= Math.exp(-d * 3.6);
    this.horizonGlow *= Math.exp(-d * 2.4);

    // Roll behaves like a struck pendulum: an impulse, a spring home, and damping.
    this.rollVel += -this.rollKick * 26 * d - this.rollVel * 3.4 * d;
    this.rollKick += this.rollVel * d;

    const target = TILT_MIN + (TILT_MAX - TILT_MIN) * eased;
    // Leaning in is roughly three times faster than leaning back out.
    const rate = target > this.tilt ? 1.9 : 0.62;
    this.tilt += (target - this.tilt) * (1 - Math.exp(-d * rate));

    const wob = this.beatWob * this.beatWob;
    // 45° is a hard ceiling, not a target the kicks are allowed to overshoot. Past
    // roughly this angle the far lanes start crowding into too few pixels to read,
    // and a camera that steals the read is worse than a camera that stays still.
    const shown = clamp(this.tilt + this.tiltKick + wob * 0.020, 0, TILT_MAX);
    this.squash = Math.cos(shown);
    this.shownTilt = shown;

    this.zoom = 1 + this.zoomKick + wob * 0.012 + eased * 0.02;
    this.roll = world.camRot + this.rollKick;
    this._fitScale();
  }

  /**
   * Height of a slab at radius `r`, in field units. Flat far out, tall up close —
   * and taller the further the field has leaned, which is what stops the deep angle
   * from just looking like a squashed circle. At the flat end slabs nearly vanish
   * and the game reads as the clean 2D disc it starts as.
   */
  _slabH(r) {
    const t = clamp(1 - r / RISE_R, 0, 1);
    const lean = clamp((this.shownTilt ?? this.tilt) / TILT_MAX, 0, 1.3);
    return WALL_H * t * t * (0.30 + 0.70 * lean);
  }

  draw(world, pal, dt, ui) {
    const ctx = this.ctx;
    const c = pal.c;
    const w = this.w;
    const h = this.h;

    this._updateCamera(world, dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c.bgDeep;
    ctx.fillRect(0, 0, w, h);

    let ox = 0;
    let oy = 0;
    if (world.shake > 0.002 && !this.reducedMotion) {
      const amt = world.shake * world.shake * 16;
      ox = (Math.random() - 0.5) * amt;
      oy = (Math.random() - 0.5) * amt;
    }
    // A deep tilt lifts the horizon, so slide the arena down to keep the same amount
    // of floor under the player instead of letting it drift up into the sky band.
    oy += (SQUASH_FLAT - this.squash) * this.scale * 0.30;

    const cx = this.cx + ox;
    const cy = this.cy + oy;
    const scale = this.scale;
    const rot = this.roll;
    const sides = Math.max(3, Math.round(world.sides));

    this._drawSky(ctx, c, w, h, cy);
    this._drawFloor(ctx, cx, cy, scale, rot, sides, c, world);
    this._drawDust(ctx, cx, cy, scale, rot, c, dt);
    this._drawWalls(ctx, cx, cy, scale, rot, c, world);
    this._drawBeatRings(ctx, cx, cy, scale, dt);
    this._drawCore(ctx, cx, cy, scale, rot, sides, c, world);
    this._drawPlayer(ctx, cx, cy, scale, rot, c, world);
    this._drawParticles(ctx, dt);

    if (world.flash > 0.004) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.5, world.flash * 0.32);
      ctx.fillStyle = c.flash;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.drawImage(this._vignette, 0, 0, w, h);

    if (ui?.showZones) this._drawTouchZones(ctx, w, h, c, ui.zonesAlpha ?? 1);
  }

  /* ------------------------------------------------------------------ */

  /**
   * A band of light where the floor plane runs out. Sells the tilt in one fill.
   *
   * This is the single strongest cue that the field is leaning, so it has to track
   * the live tilt: as the camera drops the horizon slides down the screen and the
   * sky opens above it. The rim brightens on section changes, which is what makes a
   * drop read as the lights coming up rather than as a number changing.
   */
  _drawSky(ctx, c, w, h, cy) {
    const horizon = cy - this.scale * this.squash * 1.25;
    if (horizon <= 0) return;
    ctx.fillStyle = c.bgA;
    ctx.fillRect(0, 0, w, Math.min(h, horizon));
    ctx.globalCompositeOperation = "lighter";

    const lean = clamp((this.shownTilt ?? this.tilt) / TILT_MAX, 0, 1);
    const band = 34 + lean * 46;
    ctx.globalAlpha = 0.1 + lean * 0.07 + Math.min(0.30, this.horizonGlow * 0.26);
    ctx.fillStyle = c.coreEdge;
    ctx.fillRect(0, Math.max(0, horizon - band), w, band);

    // A tighter, hotter line right on the edge. Cheap, and it gives the horizon a
    // hard top so the gradient band does not read as fog.
    ctx.globalAlpha = 0.16 + lean * 0.20 + Math.min(0.4, this.horizonGlow * 0.34);
    ctx.fillStyle = c.flash ?? c.coreEdge;
    ctx.fillRect(0, Math.max(0, horizon - 2), w, 2);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  _drawFloor(ctx, cx, cy, scale, rot, sides, c, world) {
    const step = TAU / sides;
    const R = Math.max(this.w, this.h) * 1.6 / scale; // in field units

    // Alternating wedges. Under the tilt these become the receding floor panels.
    for (let i = 0; i < sides; i++) {
      const a0 = i * step + rot;
      const a1 = a0 + step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * R * scale, cy + Math.sin(a0) * R * scale * this.squash);
      ctx.lineTo(cx + Math.cos(a1) * R * scale, cy + Math.sin(a1) * R * scale * this.squash);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? c.bgA : c.bgB;
      ctx.fill();
    }

    // Spokes let the eye count lanes at speed.
    ctx.strokeStyle = c.spoke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = i * step + rot;
      const ca = Math.cos(a);
      const sa = Math.sin(a) * this.squash;
      ctx.moveTo(cx + ca * CORE_R * scale, cy + sa * CORE_R * scale);
      ctx.lineTo(cx + ca * R * scale, cy + sa * R * scale);
    }
    ctx.stroke();

    // Concentric rings scrolling inward — this is where the sense of falling lives.
    if (this.quality >= 1) {
      const speed = world.section ? world.section.speed : 1;
      const t = (world.songTime * 0.3 * speed) % 1;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1.4;
      for (let k = 0; k < 7; k++) {
        const f = (k + t) / 7;
        const r = (0.1 + f * f * 1.9) * scale;
        if (r < CORE_R * scale) continue;
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
          const a = i * step + rot;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * this.squash;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = clamp(1 - f * 0.85, 0, 1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawDust(ctx, cx, cy, scale, rot, c, dt) {
    if (this.quality < 1 || this.reducedMotion) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = c.grid;
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustR[i] -= this.dustS[i] * dt;
      if (this.dustR[i] < 0.12) this._seedDust(i, false);
      const a = this.dustA[i] + rot;
      const r = this.dustR[i] * scale;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * this.squash;
      const s = clamp(1.4 - this.dustR[i] * 0.5, 0.4, 2.2);
      ctx.globalAlpha = clamp(1.6 - this.dustR[i], 0.06, 0.5);
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ------------------------------------------------------------------ */
  /* walls                                                              */

  /**
   * One slab. Draws the two side faces and the end caps first, then the lit top face
   * over them, so the piece reads as a solid block from any angle without needing a
   * per-face visibility test.
   */
  _drawSlab(ctx, w, cx, cy, scale, rot, c) {
    const step = TAU / w.sides;
    const a0 = w.a0 + rot;
    const n = w.span;
    const ri = w.dist * scale;
    const ro = (w.dist + w.thick) * scale;
    const drop = this._slabH(w.dist) * scale * H_PROJ;

    const isSolid = w.kind === "solid";
    const isBonus = w.kind === "bonus";
    const top = isSolid ? c.solid : isBonus ? c.bonus : c.wall;
    const side = isSolid ? c.solidDeep : isBonus ? c.bonusDeep : c.wallDeep;

    // ---- side faces -------------------------------------------------------
    if (drop > 0.5) {
      ctx.fillStyle = side;
      for (const r of [ro, ri]) {
        ctx.beginPath();
        for (let k = 0; k <= n; k++) {
          const a = a0 + k * step;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r * this.squash;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let k = n; k >= 0; k--) {
          const a = a0 + k * step;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * this.squash + drop);
        }
        ctx.closePath();
        ctx.fill();
      }

      // End caps — these are the graze edges, so they are worth drawing solid.
      if (!isSolid) {
        for (const k of [0, n]) {
          const a = a0 + k * step;
          const ca = Math.cos(a);
          const sa = Math.sin(a) * this.squash;
          ctx.beginPath();
          ctx.moveTo(cx + ca * ri, cy + sa * ri);
          ctx.lineTo(cx + ca * ro, cy + sa * ro);
          ctx.lineTo(cx + ca * ro, cy + sa * ro + drop);
          ctx.lineTo(cx + ca * ri, cy + sa * ri + drop);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ---- top face ---------------------------------------------------------
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = a0 + k * step;
      const x = cx + Math.cos(a) * ri;
      const y = cy + Math.sin(a) * ri * this.squash;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let k = n; k >= 0; k--) {
      const a = a0 + k * step;
      ctx.lineTo(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro * this.squash);
    }
    ctx.closePath();
    ctx.fillStyle = top;
    ctx.fill();
    ctx.lineWidth = isSolid ? 2.4 : 1.8;
    ctx.strokeStyle = isSolid ? c.solidEdge : isBonus ? c.bonusEdge : c.wallEdge;
    ctx.stroke();
  }

  _drawWalls(ctx, cx, cy, scale, rot, c, world) {
    const walls = world.walls;
    const limit = this._maxR;

    // Outermost first. Combined with slabs extruding away from the viewer, this is a
    // correct painter order on both halves of the tilted disc — and it puts the wall
    // that is about to hit you on top of everything else, which is what you need to see.
    const order = this._order || (this._order = []);
    order.length = 0;
    for (let i = 0; i < walls.length; i++) if (walls[i].dist * scale <= limit) order.push(walls[i]);
    order.sort((a, b) => b.dist - a.dist);

    const grazeBand = PLAYER_R * scale;

    for (let i = 0; i < order.length; i++) {
      const w = order[i];
      this._drawSlab(ctx, w, cx, cy, scale, rot, c);

      // Graze cue: light the two cut ends as the slab reaches the cursor's orbit.
      if (w.kind !== "solid" && this.quality >= 1) {
        const ri = w.dist * scale;
        const ro = (w.dist + w.thick) * scale;
        const near = Math.abs((ri + ro) * 0.5 - grazeBand);
        if (near < scale * 0.24) {
          const k = 1 - near / (scale * 0.24);
          const step = TAU / w.sides;
          const drop = this._slabH(w.dist) * scale * H_PROJ;
          ctx.strokeStyle = c.wallGraze;
          ctx.lineWidth = 2 + k * 2.6;
          ctx.globalAlpha = k * (w.grazed ? 0.28 : 0.95);
          for (const kk of [0, w.span]) {
            const a = w.a0 + kk * step + rot;
            const ca = Math.cos(a);
            const sa = Math.sin(a) * this.squash;
            ctx.beginPath();
            ctx.moveTo(cx + ca * ri, cy + sa * ri);
            ctx.lineTo(cx + ca * ro, cy + sa * ro);
            ctx.lineTo(cx + ca * ro, cy + sa * ro + drop);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      if (w.kind === "solid" && this.quality >= 1) {
        const p = 0.5 + 0.5 * Math.sin(world.songTime * 11 + w.born * 3);
        blitGlow(ctx, c.solidEdge, cx, cy, (w.dist + w.thick) * scale * 1.06, 0.1 + p * 0.14, 128);
      }
    }
  }

  _drawBeatRings(ctx, cx, cy, scale, dt) {
    if (!this.beatRings.length) return;
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.beatRings.length - 1; i >= 0; i--) {
      const r = this.beatRings[i];
      r.life -= dt * 1.6;
      r.r += dt * 1.5;
      if (r.life <= 0) {
        this.beatRings.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, r.r * scale, r.r * scale * this.squash, 0, 0, TAU);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = r.life * r.life * 0.3 * r.strength;
      ctx.lineWidth = 1.5 + r.strength * 2.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** The core is a raised pedestal — the one thing standing above the floor plane. */
  _drawCore(ctx, cx, cy, scale, rot, sides, c, world) {
    const beat = world.beatPulse;
    const heatN = clamp((world.heat - 1) / 7, 0, 1);
    const r = CORE_R * scale * (1 + beat * 0.1 + heatN * 0.05);
    const step = TAU / sides;
    const lift = (0.055 + beat * 0.015) * scale * H_PROJ;

    blitGlow(ctx, c.coreEdge, cx, cy - lift * 0.5, r * 3.6, 0.18 + beat * 0.2 + heatN * 0.18, 128);

    // pillar sides, from the floor up to the cap
    ctx.fillStyle = c.coreDeep;
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = i * step + rot;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * this.squash;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = sides; i >= 0; i--) {
      const a = i * step + rot;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * this.squash - lift);
    }
    ctx.closePath();
    ctx.fill();

    // cap
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = i * step + rot;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * this.squash - lift;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = c.core;
    ctx.fill();
    ctx.strokeStyle = c.coreEdge;
    ctx.lineWidth = 2.2 + beat * 1.6;
    ctx.stroke();

    // Charge meter rides the floor around the pedestal, so the eye never leaves centre.
    const cr = CORE_R * scale * 1.68;
    const slots = PULSE_MAX_CHARGE;
    const gap = 0.16;
    const arc = TAU / slots - gap;
    for (let i = 0; i < slots; i++) {
      const filled = clamp(world.charge - i, 0, 1);
      const a0 = -Math.PI / 2 + i * (TAU / slots) + gap * 0.5 + rot * 0.35;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr, cr * this.squash, 0, a0, a0 + arc);
      ctx.strokeStyle = c.chargeEmpty;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (filled > 0.01) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, cr, cr * this.squash, 0, a0, a0 + arc * filled);
        ctx.strokeStyle = c.charge;
        ctx.lineWidth = 4.2;
        ctx.stroke();
        if (filled > 0.999) {
          const am = a0 + arc * 0.5;
          blitGlow(ctx, c.charge, cx + Math.cos(am) * cr, cy + Math.sin(am) * cr * this.squash,
            cr * 0.45, 0.28, 64);
        }
      }
    }
  }

  _drawPlayer(ctx, cx, cy, scale, rot, c, world) {
    const a = world.angle + rot;
    const dashing = world.pulseTimer > 0;
    const r = PLAYER_R * scale;
    const ca = Math.cos(a);
    const sa = Math.sin(a);

    const fx = cx + ca * r;
    const fy = cy + sa * r * this.squash;      // where the cursor touches the floor
    const lift = 0.035 * scale * H_PROJ;
    const px = fx;
    const py = fy - lift;

    // Floor shadow — the single cheapest cue that the cursor is above the plane.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(fx, fy, scale * 0.016, scale * 0.016 * this.squash, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    blitGlow(ctx, dashing ? c.pulse : c.playerGlow, px, py, scale * (dashing ? 0.16 : 0.09),
      dashing ? 0.6 : 0.3, 128);

    if (dashing) {
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.ellipse(cx, cy - lift, r, r * this.squash, 0, a - world.dir * 0.5, a, world.dir > 0);
      ctx.strokeStyle = c.pulse;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = scale * 0.014;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // The triangle's base spans exactly the collision half-width, so the shape on
    // screen IS the hitbox. Anything else and the player learns a lie.
    const spread = PLAYER_HALF_W;
    const halfBase = Math.sin(spread) * r;
    const tipR = r + halfBase * 2.2;
    const baseR = r - halfBase * 0.55;
    const p = (rr, aa) => [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * this.squash - lift];

    const [tx, ty] = p(tipR, a);
    const [lx, ly] = p(baseR, a - spread);
    const [rx, ry] = p(baseR, a + spread);

    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 4.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = dashing ? c.pulse : c.player;
    ctx.fill();
    ctx.strokeStyle = dashing ? "#fff" : "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  _drawParticles(ctx, dt) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < PARTICLE_MAX; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const nl = life - dt;
      this.plife[i] = nl;
      if (nl <= 0) continue;
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      this.pvx[i] *= 1 - dt * 2.1;
      this.pvy[i] *= 1 - dt * 2.1;
      const t = nl / this.pmax[i];
      blitGlow(ctx, this.pcolor[i], this.px[i], this.py[i], this.psize[i] * (0.5 + t), t * 0.8, 64);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  _drawTouchZones(ctx, w, h, c, alpha) {
    const centerW = w * 0.24;
    const x0 = (w - centerW) / 2;
    ctx.globalAlpha = alpha * 0.1;
    ctx.fillStyle = c.wallEdge;
    ctx.fillRect(0, 0, x0, h);
    ctx.fillRect(x0 + centerW, 0, x0, h);
    ctx.globalAlpha = alpha * 0.16;
    ctx.fillStyle = c.pulse;
    ctx.fillRect(x0, 0, centerW, h);
    ctx.globalAlpha = 1;
  }

  get _maxR() {
    return Math.max(this.w, this.h) * 1.3;
  }

  /** Screen position of the cursor — used to anchor particle bursts. */
  playerScreen(world) {
    // `this.roll`, not world.camRot: bursts have to spawn where the cursor is being
    // DRAWN, and the drawn cursor carries the renderer's roll kick as well.
    const a = world.angle + (this.roll ?? world.camRot);
    const r = PLAYER_R * this.scale;
    return {
      x: this.cx + Math.cos(a) * r,
      y: this.cy + Math.sin(a) * r * this.squash - 0.035 * this.scale * H_PROJ,
    };
  }
}
