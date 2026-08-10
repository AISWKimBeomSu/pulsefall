// Gameplay sound. The research notes call out that in a game built on hundreds of
// 5-second failures, audio feedback IS the reward structure — the original leaned on
// a voice actor for it. We get the same job done with pitched stingers that rise as
// the graze chain grows, so the player can hear their own streak without looking.

const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic — anything sounds consonant

export class Sfx {
  constructor(engine) {
    this.engine = engine;
    this.enabled = true;
    this._lastGraze = 0;
  }

  get t() {
    return this.engine.now;
  }

  graze(chain) {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    if (t - this._lastGraze < 0.028) return; // avoid machine-gunning on long edges
    this._lastGraze = t;
    const step = Math.min(chain, 24);
    const midi = 76 + PENTA[step % 5] + 12 * Math.floor(step / 5);
    this.engine.blip(t, midi, {
      gain: 0.075 + Math.min(chain, 12) * 0.004,
      dur: 0.075,
      type: "triangle",
      send: 0.35,
    });
  }

  pulse(perfect) {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    this.engine.noiseBurst(t, {
      gain: perfect ? 0.3 : 0.2,
      dur: perfect ? 0.32 : 0.22,
      from: perfect ? 5200 : 2600,
      to: 320,
      q: 1.4,
      send: 0.4,
    });
    if (perfect) {
      // a bright fifth so a beat-locked pulse is unmistakable
      this.engine.blip(t, 88, { gain: 0.2, dur: 0.2, type: "square", send: 0.5 });
      this.engine.blip(t + 0.045, 95, { gain: 0.15, dur: 0.24, type: "square", send: 0.55 });
    } else {
      this.engine.blip(t, 64, { gain: 0.1, dur: 0.1, type: "sawtooth", send: 0.2 });
    }
  }

  pulseFail() {
    if (!this.engine.ctx || !this.enabled) return;
    this.engine.blip(this.t, 45, { gain: 0.13, dur: 0.09, type: "square", send: 0.05 });
  }

  charge(level) {
    if (!this.engine.ctx || !this.enabled) return;
    this.engine.blip(this.t, 72 + level * 7, { gain: 0.16, dur: 0.16, type: "triangle", send: 0.5 });
  }

  heatTier(tier) {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    for (let i = 0; i < 3; i++) {
      this.engine.blip(t + i * 0.05, 72 + tier * 3 + i * 5, { gain: 0.13, dur: 0.14, type: "square", send: 0.45 });
    }
  }

  death() {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    this.engine.duck(0.22, 0.14, 0.35);
    this.engine.sweep(t, 620, 42, 0.72, { gain: 0.3, type: "sawtooth", send: 0.55 });
    this.engine.noiseBurst(t, { gain: 0.4, dur: 0.5, from: 3400, to: 90, q: 0.6, send: 0.5 });
    this.engine.kick(t, { gain: 1.0, pitch: 220, drop: 28, decay: 0.5, bus: this.engine.sfxBus });
  }

  section(index) {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    const base = 69 + (index % 4) * 2;
    this.engine.blip(t, base, { gain: 0.2, dur: 0.3, type: "square", send: 0.6 });
    this.engine.blip(t + 0.08, base + 7, { gain: 0.17, dur: 0.34, type: "square", send: 0.6 });
    this.engine.blip(t + 0.16, base + 12, { gain: 0.15, dur: 0.4, type: "square", send: 0.65 });
  }

  best() {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    [76, 83, 88, 91].forEach((m, i) => {
      this.engine.blip(t + i * 0.07, m, { gain: 0.19, dur: 0.35, type: "triangle", send: 0.6 });
    });
  }

  clear() {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    [64, 71, 76, 79, 83, 88].forEach((m, i) => {
      this.engine.blip(t + i * 0.1, m, { gain: 0.22, dur: 0.7, type: "triangle", send: 0.7 });
    });
    this.engine.noiseBurst(t, { gain: 0.22, dur: 1.4, from: 8000, to: 400, q: 0.5, send: 0.7 });
  }

  uiMove() {
    if (!this.engine.ctx || !this.enabled) return;
    this.engine.blip(this.t, 79, { gain: 0.09, dur: 0.06, type: "square", send: 0.1 });
  }

  uiConfirm() {
    if (!this.engine.ctx || !this.enabled) return;
    const t = this.t;
    this.engine.blip(t, 76, { gain: 0.13, dur: 0.09, type: "square", send: 0.2 });
    this.engine.blip(t + 0.06, 88, { gain: 0.11, dur: 0.14, type: "square", send: 0.3 });
  }

  countdown(n) {
    if (!this.engine.ctx || !this.enabled) return;
    this.engine.blip(this.t, n === 0 ? 88 : 76, { gain: 0.17, dur: n === 0 ? 0.3 : 0.12, type: "square", send: 0.35 });
  }
}
