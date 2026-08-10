// Step sequencer. Schedules ahead on the AudioContext clock (the "two clocks"
// pattern) so timing is sample-accurate and immune to frame hitches.
//
// The same section list that drives this sequencer also drives the wall chart, so
// a drop in the music IS a drop in the gameplay. That relationship is the whole
// point of the rewrite.

const LOOKAHEAD = 0.14; // seconds of audio scheduled in advance
const TICK_MS = 22;

/** Build a diatonic triad (+ extensions) from a scale, rooted on `degree`. */
export function chordTones(scale, degree, count = 5) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const idx = degree + k * 2;
    const oct = Math.floor(idx / scale.length);
    out.push(scale[idx % scale.length] + 12 * oct);
  }
  return out;
}

/**
 * Step strings use one character per 16th note:
 *   '.'    rest
 *   'x'    hit (drums)
 *   'X'    accent
 *   '0'-'7' chord-tone index (melodic parts)
 *   '-'    sustain previous melodic note
 */
function stepChar(pattern, i) {
  if (!pattern) return ".";
  return pattern[i % pattern.length] || ".";
}

export class MusicPlayer {
  constructor(engine) {
    this.engine = engine;
    this.track = null;
    this.playing = false;
    this.startTime = 0;
    this.step = 0;
    this.nextStepTime = 0;
    this.spb = 0.5;
    this.sps = 0.125;
    this._timer = 0;
    this._barSections = [];
    this._lastNoteMidi = { bass: null, arp: null };
    this.onSection = null;
  }

  get songTime() {
    if (!this.playing || !this.engine.ctx) return this._frozenTime || 0;
    return this.engine.ctx.currentTime - this.startTime;
  }

  get totalTime() {
    if (!this.track) return 1;
    return this.track.bars * 4 * this.spb;
  }

  /** Absolute audio time of the downbeat that step 0 lands on. */
  play(track, { fromBeat = 0, leadIn = 0.12 } = {}) {
    const ctx = this.engine.init();
    if (!ctx) return;
    this.stop();

    this.track = track;
    this.spb = 60 / track.bpm;
    this.sps = this.spb / 4;
    this.engine.setDelayTime(this.spb * 0.75); // dotted eighth

    // Expand sections into a per-bar lookup once.
    this._barSections = [];
    let bar = 0;
    for (const s of track.sections) {
      s._startBar = bar; // recomputed every play so replays and mode switches stay correct
      for (let i = 0; i < s.bars; i++) this._barSections[bar++] = s;
    }
    this.track.bars = bar;

    this.step = Math.max(0, Math.round(fromBeat * 4));
    const now = ctx.currentTime + leadIn;
    this.startTime = now - this.step * this.sps;
    this.nextStepTime = now;
    this.playing = true;
    this._frozenTime = 0;
    this._currentSection = null;

    this._timer = setInterval(() => this._schedule(), TICK_MS);
    this._schedule();
  }

  stop({ fade = 0.12 } = {}) {
    if (this._timer) clearInterval(this._timer);
    this._timer = 0;
    if (this.playing) this._frozenTime = this.songTime;
    this.playing = false;
  }

  _schedule() {
    const ctx = this.engine.ctx;
    if (!ctx || !this.playing) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    let guard = 0;
    while (this.nextStepTime < horizon && guard++ < 128) {
      this._emit(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += this.sps;
    }
  }

  _emit(step, time) {
    const track = this.track;
    const bar = Math.floor(step / 16);
    if (bar >= track.bars) {
      this.stop();
      return;
    }
    const s = this._barSections[bar];
    if (!s) return;

    if (s !== this._currentSection) {
      this._currentSection = s;
      if (this.onSection) this.onSection(s, bar, time);
      if (s.fx?.impact) {
        this.engine.noiseBurst(time, { gain: 0.34, dur: 1.5, from: 6000, to: 120, q: 0.7, bus: this.engine.musicBus, send: 0.6 });
      }
    }

    const i = step % 16;
    const eng = this.engine;
    const prog = s.prog || [0];
    const degree = prog[bar % prog.length];
    const tones = chordTones(track.scale, degree, 6);
    const root = track.root;

    // ---- drums -------------------------------------------------------------
    const d = s.drums || {};
    const k = stepChar(d.kick, i);
    if (k !== ".") eng.kick(time, { gain: k === "X" ? 1.05 : 0.85, decay: s.fx?.longKick ? 0.4 : 0.3 });

    const sn = stepChar(d.snare, i);
    if (sn !== ".") eng.snare(time, { gain: sn === "X" ? 0.62 : 0.42, decay: sn === "X" ? 0.22 : 0.15 });

    const h = stepChar(d.hat, i);
    if (h !== ".") {
      eng.hat(time, {
        gain: h === "X" ? 0.24 : 0.13,
        decay: h === "X" ? 0.13 : 0.035,
        cutoff: h === "X" ? 6200 : 8200,
      });
    }

    // ---- bass --------------------------------------------------------------
    const b = stepChar(s.bass, i);
    if (b !== "." && b !== "-") {
      const ti = Number(b);
      const midi = root - 24 + tones[ti % tones.length];
      // hold the note until the next non-sustain event
      let len = 1;
      while (stepChar(s.bass, i + len) === "-" && len < 16) len++;
      eng.bass(time, midi, len * this.sps * 0.95, {
        gain: s.bassGain ?? 0.46,
        cutoff: s.bassCutoff ?? 780,
      });
    }

    // ---- arp / lead --------------------------------------------------------
    const a = stepChar(s.arp, i);
    if (a !== "." && a !== "-") {
      const ti = Number(a);
      const midi = root + (s.arpOct ?? 12) + tones[ti % tones.length];
      let len = 1;
      while (stepChar(s.arp, i + len) === "-" && len < 16) len++;
      eng.pluck(time, midi, len * this.sps * (s.arpLen ?? 1.6), {
        gain: s.arpGain ?? 0.2,
        cutoff: s.arpCutoff ?? 3000,
        echo: s.arpEcho ?? 0.26,
        send: 0.22,
      });
    }

    // ---- pad ---------------------------------------------------------------
    if (s.pad && i === 0) {
      const voicing = [tones[0], tones[1], tones[2], tones[3]].map((n) => root + n);
      eng.pad(time, voicing, this.spb * 4 * 0.98, {
        gain: s.padGain ?? 0.075,
        cutoff: s.padCutoff ?? 1400,
      });
    }

    // ---- riser into the next section --------------------------------------
    if (s.fx?.riser && bar === s._startBar + s.bars - 1 && i === 0) {
      eng.sweep(time, 180, 2400, this.spb * 4, { gain: 0.16, bus: this.engine.musicBus, send: 0.5 });
      eng.noiseBurst(time, { gain: 0.1, dur: this.spb * 4, from: 400, to: 9000, q: 1.2, bus: this.engine.musicBus, send: 0.4 });
    }
  }
}
