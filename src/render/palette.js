// Colour. Each track carries a list of palettes; sections index into it, and the
// renderer cross-fades between them so a section change is felt as a wash of colour
// rather than a hard cut.

import { clamp, lerp } from "../core/mathx.js";

/** [hue, sat, light-bias] — the rest of the ramp is derived so themes stay coherent. */
const THEMES = {
  ember: [
    [28, 82, 0], [16, 86, 2], [44, 78, -2], [4, 88, 4], [340, 74, 2], [52, 90, 6], [12, 84, 0],
  ],
  violet: [
    [268, 70, 0], [292, 76, 2], [318, 72, -2], [250, 80, 3], [206, 78, 1], [332, 84, 5], [280, 76, 0],
  ],
  void: [
    [168, 66, -2], [186, 72, 0], [148, 70, 1], [200, 76, 2], [122, 62, -1], [92, 74, 4], [176, 80, 3],
  ],
  endless: [
    [200, 72, 0], [258, 74, 1], [318, 72, 0], [22, 82, 2], [56, 78, 3], [140, 68, 0], [172, 74, 1],
  ],
};

function hslStr(h, s, l, a = 1) {
  const hh = ((h % 360) + 360) % 360;
  return a >= 1
    ? `hsl(${hh.toFixed(1)} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}%)`
    : `hsl(${hh.toFixed(1)} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}% / ${a.toFixed(3)})`;
}

/** Shortest-path hue interpolation. */
function lerpHue(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export class Palette {
  constructor(themeName) {
    this.setTheme(themeName);
    this.index = 0;
    this.prevIndex = 0;
    this.t = 1;
    this._dirty = true;
    this.c = {};
    this.rebuild(0);
  }

  setTheme(name) {
    this.ramp = THEMES[name] || THEMES.ember;
    this._dirty = true;
  }

  /** Begin a cross-fade toward palette `i`. */
  goto(i) {
    const next = ((i % this.ramp.length) + this.ramp.length) % this.ramp.length;
    if (next === this.index) return;
    this.prevIndex = this.index;
    this.index = next;
    this.t = 0;
    this._dirty = true;
  }

  update(dt) {
    if (this.t < 1) {
      this.t = clamp(this.t + dt * 1.35, 0, 1);
      this._dirty = true;
    }
  }

  /**
   * `energy` (0..1) brightens the whole set — driven by heat, so a player on a long
   * graze chain literally lights the room up. Cheap, and it makes skill legible.
   */
  rebuild(energy) {
    const e = clamp(energy, 0, 1);
    if (!this._dirty && Math.abs(e - this._lastE) < 0.02) return;
    this._lastE = e;
    this._dirty = false;

    const a = this.ramp[this.prevIndex];
    const b = this.ramp[this.index];
    const t = this.t;
    const h = lerpHue(a[0], b[0], t);
    const s = lerp(a[1], b[1], t);
    const lb = lerp(a[2], b[2], t);

    const c = this.c;
    c.hue = h;

    // Background: two alternating wedges, both nearly black and nearly grey. The
    // whole readability of the game rests on the walls being the only saturated,
    // bright thing on screen — the moment the background competes for colour, the
    // player has to *look for* the gap instead of seeing it.
    c.bgA = hslStr(h, s * 0.3, 4.5 + lb * 0.5 + e * 1.4);
    c.bgB = hslStr(h, s * 0.26, 9 + lb * 0.7 + e * 2.2);
    c.bgDeep = hslStr(h, s * 0.34, 2.5 + lb * 0.3);
    c.grid = hslStr(h + 14, s * 0.55, 34 + e * 12, 0.2 + e * 0.14);
    c.spoke = hslStr(h + 8, s * 0.5, 26 + e * 10, 0.13 + e * 0.09);

    // walls — the bright layer
    c.wall = hslStr(h + 6, Math.min(100, s * 1.08), 60 + lb + e * 6);
    c.wallDeep = hslStr(h + 2, s * 0.86, 20 + lb * 0.4 + e * 3);
    c.wallEdge = hslStr(h + 20, 100, 88 + e * 6);
    c.wallGraze = hslStr(h + 40, 100, 92);

    // special walls — a hue jump, so "you cannot dodge this" is pre-attentive
    c.solid = hslStr(h + 178, 96, 60 + e * 8);
    c.solidDeep = hslStr(h + 178, 82, 22 + e * 3);
    c.solidEdge = hslStr(h + 184, 100, 90);
    c.bonus = hslStr(h + 128, 90, 58 + e * 6);
    c.bonusDeep = hslStr(h + 128, 78, 20 + e * 3);
    c.bonusEdge = hslStr(h + 128, 100, 90);

    // player + core
    c.core = hslStr(h + 10, s * 0.55, 16 + e * 6);
    c.coreDeep = hslStr(h + 6, s * 0.6, 7 + e * 3);
    c.coreEdge = hslStr(h + 22, Math.min(100, s * 1.1), 78 + e * 12);
    c.player = `hsl(0 0% ${(97 + e * 3).toFixed(0)}%)`;
    c.playerGlow = hslStr(h + 44, 100, 76);
    c.charge = hslStr(h + 56, 100, 70 + e * 8);
    c.chargeEmpty = hslStr(h, s * 0.4, 26, 0.55);
    c.pulse = hslStr(h + 62, 100, 86);
    c.accent = hslStr(h + 150, 96, 66);
    c.flash = hslStr(h + 30, 55, 94);
    return c;
  }
}
