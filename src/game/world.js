// Simulation. Runs at a fixed 240 Hz, allocates nothing in the hot path, and knows
// nothing about canvas or audio — it only reads a song clock and emits events.

import {
  TAU, clamp, wrapTau, angleDist,
} from "../core/mathx.js";
import {
  CORE_R, PLAYER_R, SPAWN_R, DESPAWN_R, PLAYER_SPEED, BASE_WALL_SPEED, PLAYER_HALF_W, START_ANGLE, HIT_FORGIVE,
  PULSE_DURATION, PULSE_SPEED_MUL, PULSE_COOLDOWN, PULSE_COST, PULSE_REFUND_ONBEAT,
  PULSE_MAX_CHARGE, PULSE_REGEN, BEAT_WINDOW,
  GRAZE_WINDOW, GRAZE_CHARGE,
  HEAT_MIN, HEAT_MAX, HEAT_PER_GRAZE, HEAT_PER_PERFECT_PULSE, HEAT_DECAY, HEAT_GRACE,
  SCORE_RATE,
} from "./constants.js";

const POOL_SIZE = 320;

function makeWall() {
  return {
    active: false,
    side: 0, span: 1, sides: 6,
    dist: 0, thick: 0.1, speed: 1,
    kind: "wall",
    a0: 0, a1: 0,
    grazed: false, consumed: false,
    born: 0,
  };
}

export class World {
  constructor() {
    this.pool = new Array(POOL_SIZE);
    for (let i = 0; i < POOL_SIZE; i++) this.pool[i] = makeWall();
    this.walls = [];
    this.events = [];
    this.chart = null;
    this.reset(null);
  }

  /* ------------------------------------------------------------------ */

  reset(chart, { startTime = 0 } = {}) {
    this.chart = chart;
    this.status = "ready"; // ready | running | dead | cleared
    this.songTime = startTime;
    this._clockBias = 0;
    this.runTime = 0;

    this.angle = wrapTau(START_ANGLE); // straight up on every polygon
    this.dir = 0;
    this.moveMul = 1;

    this.pulseTimer = 0;
    this.pulseCooldown = 0;
    this.charge = 1.0;
    this.pulseRequested = false;
    this.lastPulsePerfect = false;

    this.heat = HEAT_MIN;
    this.heatTier = 0;
    this.grazeTimer = 99;
    this.chain = 0;
    this.bestChain = 0;
    this.score = 0;
    this.grazeCount = 0;
    this.pulseCount = 0;
    this.perfectCount = 0;

    this.camRot = 0;
    this.camVel = 0;
    this.spin = 0;
    this.shake = 0;
    this.flash = 0;
    this.beatPulse = 0;

    this.sides = 6;
    this.sidesTarget = 6;
    this.section = null;
    this.sectionIndex = -1;
    this.deathTimer = 0;
    this.deathAngle = 0;

    this._spawnIdx = 0;
    this._rotFlipTimer = 2;
    this._rotSign = 1;
    this._lastBeatIndex = -1;

    for (const w of this.walls) w.active = false;
    this.walls.length = 0;
    this.events.length = 0;

    if (chart) {
      this.sides = chart.sections[0]?.sides ?? 6;
      this.sidesTarget = this.sides;
      // Fast-forward the spawn cursor for practice starts.
      while (
        this._spawnIdx < chart.walls.length &&
        chart.walls[this._spawnIdx].spawnTime < startTime - 0.05
      ) this._spawnIdx++;
    }
  }

  start() {
    if (this.status === "ready") this.status = "running";
  }

  /* ------------------------------------------------------------------ */
  /* input                                                              */

  setDir(d) {
    this.dir = d;
  }

  requestPulse() {
    this.pulseRequested = true;
  }

  /**
   * Phase-lock the simulation clock to the audio clock without ever jerking.
   * Returns true if the two have come apart so far that the run is no longer
   * salvageable — the audio clock keeps running when rAF is throttled (backgrounded
   * tab, OS sleep), and silently teleporting the world forward would kill the player
   * with walls they never saw.
   */
  syncClock(audioTime) {
    if (this.status !== "running") return false;
    const err = audioTime - this.songTime;
    const mag = Math.abs(err);
    if (mag > 0.6) return true;
    if (mag > 0.22) {
      this.songTime = audioTime;
      this._clockBias = 0;
    } else {
      this._clockBias = clamp(err * 2.4, -0.25, 0.25);
    }
    return false;
  }

  emit(type, data) {
    this.events.push(data ? { type, ...data } : { type });
  }

  /* ------------------------------------------------------------------ */
  /* main step                                                          */

  step(dt) {
    if (this.status === "dead") {
      this.deathTimer += dt;
      this.shake = Math.max(0, this.shake - dt * 2.2);
      this.flash = Math.max(0, this.flash - dt * 3.4);
      this.camRot += this.camVel * dt * 0.35;
      for (let i = this.walls.length - 1; i >= 0; i--) {
        const w = this.walls[i];
        w.dist += dt * 0.35; // walls drift back outward — reads as the run unwinding
      }
      return;
    }
    if (this.status !== "running") {
      this.shake = Math.max(0, this.shake - dt * 3);
      this.flash = Math.max(0, this.flash - dt * 4);
      return;
    }

    this.songTime += dt * (1 + this._clockBias);
    this.runTime += dt;

    this._updateSection();
    this._updateBeat();
    this._spawn();
    this._movePlayer(dt);
    this._updatePulse(dt);
    this._moveWalls(dt);
    this._collide(dt);
    this._updateHeat(dt);
    this._updateCamera(dt);

    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.4);

    if (this.chart && this.songTime >= this.chart.duration) {
      this.status = "cleared";
      this.emit("clear");
    }
  }

  /* ------------------------------------------------------------------ */

  _updateSection() {
    const chart = this.chart;
    if (!chart) return;
    const beat = this.songTime / chart.spb;
    const secs = chart.sections;
    let idx = this.sectionIndex;
    // Sections only advance, so a forward scan is enough.
    while (idx + 1 < secs.length && beat >= secs[idx + 1].startBeat) idx++;
    if (idx < 0) idx = 0;
    if (idx !== this.sectionIndex) {
      this.sectionIndex = idx;
      this.section = secs[idx];
      this.sidesTarget = this.section.sides;
      this._rotSign = this.section.rot >= 0 ? 1 : -1;
      this._rotFlipTimer = this.section.rotFlip > 0 ? 3 / this.section.rotFlip : 999;
      if (this.section.spin) this.spin += 5.2 * (Math.random() < 0.5 ? -1 : 1);
      this.flash = Math.min(1, this.flash + 0.5);
      this.emit("section", { section: this.section, index: idx });
    }
  }

  _updateBeat() {
    if (!this.chart) return;
    const b = Math.floor(this.songTime / this.chart.spb);
    if (b !== this._lastBeatIndex) {
      this._lastBeatIndex = b;
      this.beatPulse = 1;
      this.emit("beat", { index: b });
    }
  }

  /** Seconds to the nearest beat boundary — the on-beat pulse judgement. */
  beatError() {
    if (!this.chart) return 1;
    const spb = this.chart.spb;
    const phase = (this.songTime / spb) % 1;
    return Math.min(phase, 1 - phase) * spb;
  }

  _spawn() {
    const chart = this.chart;
    if (!chart) return;
    const list = chart.walls;
    while (this._spawnIdx < list.length && list[this._spawnIdx].spawnTime <= this.songTime) {
      const src = list[this._spawnIdx++];
      const w = this._take();
      if (!w) continue;
      w.side = src.side;
      w.span = src.span;
      w.sides = src.sides;
      w.thick = src.thick;
      w.speed = src.speed;
      w.kind = src.kind;
      w.grazed = false;
      w.consumed = false;
      w.born = this.songTime;
      // Catch up any wall whose spawn moment was clipped at the start of a run.
      const late = this.songTime - src.spawnTime;
      w.dist = SPAWN_R - BASE_WALL_SPEED * w.speed * late;
      const step = TAU / w.sides;
      w.a0 = w.side * step;
      w.a1 = w.a0 + w.span * step;
      if (w.dist > DESPAWN_R) this.walls.push(w);
      else w.active = false;
    }
  }

  _take() {
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].active) {
        pool[i].active = true;
        return pool[i];
      }
    }
    return null;
  }

  _movePlayer(dt) {
    const boost = this.pulseTimer > 0 ? PULSE_SPEED_MUL : 1;
    if (this.dir !== 0) {
      this.angle = wrapTau(this.angle + this.dir * PLAYER_SPEED * boost * this.moveMul * dt);
    }
  }

  _updatePulse(dt) {
    if (this.pulseTimer > 0) this.pulseTimer -= dt;
    if (this.pulseCooldown > 0) this.pulseCooldown -= dt;

    // Passive trickle back to a single charge — never past it.
    if (this.charge < 1) this._addCharge(Math.min(PULSE_REGEN * dt, 1 - this.charge));

    if (this.pulseRequested) {
      this.pulseRequested = false;
      if (this.pulseCooldown <= 0) {
        const err = this.beatError();
        const perfect = err <= BEAT_WINDOW;
        const cost = perfect ? PULSE_COST - PULSE_REFUND_ONBEAT : PULSE_COST;
        // On the beat you are never refused; off the beat you pay in full or nothing
        // happens. See ONBEAT_ALWAYS_ALLOWED.
        if (perfect || this.charge >= cost - 1e-6) {
          this.charge = Math.max(0, this.charge - cost);
          this.pulseTimer = PULSE_DURATION;
          this.pulseCooldown = PULSE_COOLDOWN;
          this.lastPulsePerfect = perfect;
          this.pulseCount++;
          this.shake = Math.min(1, this.shake + (perfect ? 0.42 : 0.22));
          this.flash = Math.min(1, this.flash + (perfect ? 0.55 : 0.2));
          if (perfect) {
            this.perfectCount++;
            this._addHeat(HEAT_PER_PERFECT_PULSE);
          }
          this.emit("pulse", { perfect });
        } else {
          this.pulseCooldown = 0.16;
          this.emit("pulseFail");
        }
      }
    }
  }

  _moveWalls(dt) {
    const walls = this.walls;
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      w.dist -= BASE_WALL_SPEED * w.speed * dt;
      if (w.dist + w.thick < DESPAWN_R) {
        w.active = false;
        const last = walls.length - 1;
        walls[i] = walls[last];
        walls.pop();
      }
    }
  }

  _collide(dt) {
    const walls = this.walls;
    const pa = this.angle;
    const hw = PLAYER_HALF_W;
    const intangible = this.pulseTimer > 0;

    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      // Radial overlap, with the wall shrunk by a hair at both faces. That sliver is
      // the difference between "I misplayed" and "the game cheated" — and it has to
      // be the SAME predicate the fairness solver and the autoplay bot use, or the
      // chart is validated against a hitbox the player does not have.
      const inner = w.dist + HIT_FORGIVE;
      const outer = w.dist + w.thick - HIT_FORGIVE;
      if (outer < PLAYER_R || inner > PLAYER_R) continue;

      const full = w.span >= w.sides;
      const overlap = full || this._angularOverlap(pa, hw, w.a0, w.a1);

      if (overlap) {
        if (w.kind === "bonus") {
          if (!w.consumed) {
            w.consumed = true;
            this._addCharge(0.55);
            this._addHeat(0.22);
            this.emit("bonus");
          }
          continue;
        }
        if (!intangible) {
          this._die(w);
          return;
        }
        continue;
      }

      // Not inside — is it close enough to the edge to count as a graze?
      if (w.grazed || w.kind === "bonus") continue;
      const d = Math.min(angleDist(pa, w.a0), angleDist(pa, w.a1));
      const edge = d - hw;
      if (edge < GRAZE_WINDOW) {
        const q = clamp(1 - edge / GRAZE_WINDOW, 0, 1);
        if (q > 0.1) {
          w.grazed = true;
          this._graze(q);
        }
      }
    }
  }

  _angularOverlap(pa, hw, a0, a1) {
    // Walls never span more than TAU, so testing the cursor's two edges plus its
    // centre against the wall arc is exact for the widths we use.
    return (
      this._inArc(pa, a0, a1) ||
      this._inArc(pa - hw, a0, a1) ||
      this._inArc(pa + hw, a0, a1)
    );
  }

  _inArc(a, a0, a1) {
    let rel = (a - a0) % TAU;
    if (rel < 0) rel += TAU;
    return rel < a1 - a0;
  }

  _graze(q) {
    this.grazeCount++;
    this.chain++;
    if (this.chain > this.bestChain) this.bestChain = this.chain;
    this.grazeTimer = 0;
    this._addCharge(GRAZE_CHARGE * (0.55 + q * 0.45));
    this._addHeat(HEAT_PER_GRAZE * q);
    this.emit("graze", { quality: q, chain: this.chain });
  }

  _addCharge(amount) {
    const before = Math.floor(this.charge);
    this.charge = clamp(this.charge + amount, 0, PULSE_MAX_CHARGE);
    const after = Math.floor(this.charge);
    if (after > before) this.emit("chargeFull", { level: after });
  }

  _addHeat(amount) {
    this.heat = clamp(this.heat + amount, HEAT_MIN, HEAT_MAX);
    const tier = Math.floor(this.heat);
    if (tier > this.heatTier) {
      this.heatTier = tier;
      this.emit("heatTier", { tier });
    } else if (tier < this.heatTier) {
      this.heatTier = tier;
    }
  }

  _updateHeat(dt) {
    this.grazeTimer += dt;
    if (this.grazeTimer > HEAT_GRACE) {
      const over = this.grazeTimer - HEAT_GRACE;
      this.heat = clamp(this.heat - HEAT_DECAY * Math.min(1 + over * 0.5, 2.4) * dt, HEAT_MIN, HEAT_MAX);
      this.heatTier = Math.floor(this.heat);
    }
    if (this.grazeTimer > 1.6) this.chain = 0;
    this.score += this.heat * SCORE_RATE * dt;
  }

  _updateCamera(dt) {
    const s = this.section;
    const baseRot = s ? Math.abs(s.rot) : 0.2;

    if (s && s.rotFlip > 0) {
      this._rotFlipTimer -= dt;
      if (this._rotFlipTimer <= 0) {
        this._rotSign *= -1;
        // Rotation is information as much as difficulty: it lets the player preview
        // the far side of the arena. Flipping too often removes that, so the window
        // stays inside 2.4-7 s no matter how hard the section is.
        this._rotFlipTimer = 2.4 + Math.random() * 4.6 / Math.max(s.rotFlip, 0.25);
      }
    }

    const target = baseRot * this._rotSign * (1 + (this.heat - 1) * 0.045);
    this.camVel += (target - this.camVel) * Math.min(1, dt * 2.2);
    this.spin *= Math.exp(-dt * 2.6);
    this.camRot = wrapTau(this.camRot + (this.camVel + this.spin) * dt);

    // Arena side count eases toward the section's value so morphs read as motion.
    if (this.sides !== this.sidesTarget) {
      const d = this.sidesTarget - this.sides;
      const stepAmt = Math.sign(d) * Math.min(Math.abs(d), dt * 7);
      this.sides += stepAmt;
      if (Math.abs(this.sidesTarget - this.sides) < 0.02) this.sides = this.sidesTarget;
    }
  }

  _die(wall) {
    this.status = "dead";
    this.deathTimer = 0;
    this.deathAngle = this.angle;
    this.shake = 1;
    this.flash = 1;
    this.emit("death", { wall });
  }

  /* ------------------------------------------------------------------ */

  get progress() {
    if (!this.chart) return 0;
    return clamp(this.songTime / this.chart.duration, 0, 1);
  }

  get coreRadius() {
    return CORE_R;
  }
}
