// Web Audio plumbing: master bus, sends, and the synth voices the sequencer plays.
//
// Everything is generated at runtime. No mp3, no decode stutter (the Android build of
// decoding a compressed file mid-run is a known stutter source), no license to clear,
// and — the real win — the music and the wall chart are driven by the same clock, so
// sync is exact by construction rather than by tuning an offset.

const A4 = 440;

export function midiToHz(m) {
  return A4 * Math.pow(2, (m - 69) / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicVolume = 0.62;
    this.sfxVolume = 0.85;
    this._noise = null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;

    // --- master chain -------------------------------------------------------
    const master = ctx.createGain();
    master.gain.value = 0.9;

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 22;
    glue.ratio.value = 3.6;
    glue.attack.value = 0.004;
    glue.release.value = 0.22;

    // Gentle high shelf so the mix does not get harsh when everything hits at once.
    const tame = ctx.createBiquadFilter();
    tame.type = "highshelf";
    tame.frequency.value = 6400;
    tame.gain.value = -3.5;

    master.connect(glue);
    glue.connect(tame);
    tame.connect(ctx.destination);

    this.master = master;
    // Last node before the speakers. The capture path taps here so a recording gets
    // the mix exactly as mastered, glue and shelf included.
    this.finalNode = tame;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(master);

    // --- sends --------------------------------------------------------------
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 1.9, 2.6);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.5;
    verb.connect(verbGain);
    verbGain.connect(master);
    this.reverb = verb;

    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 2400;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.42;
    delay.connect(delayTone);
    delayTone.connect(fb);
    fb.connect(delay);
    delayTone.connect(delayOut);
    delayOut.connect(master);
    this.delay = delay;
    this._delayFeedback = fb;

    this._noise = makeNoise(ctx, 2);
    this.ready = true;
    return ctx;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setDelayTime(seconds) {
    if (!this.ctx) return;
    this.delay.delayTime.setTargetAtTime(seconds, this.now, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.now, 0.02);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v, this.now, 0.05);
  }

  /** Duck the music briefly — used on death so the impact reads. */
  duck(amount = 0.35, hold = 0.18, release = 0.5) {
    if (!this.ctx) return;
    const g = this.musicBus.gain;
    const t = this.now;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVolume * amount, t + 0.02);
    g.setValueAtTime(this.musicVolume * amount, t + hold);
    g.linearRampToValueAtTime(this.musicVolume, t + hold + release);
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    return src;
  }

  // ---------------------------------------------------------------------------
  // Voices. Each schedules itself at an absolute AudioContext time and self-cleans.
  // ---------------------------------------------------------------------------

  kick(t, { gain = 1, pitch = 152, drop = 44, decay = 0.3, bus = this.musicBus } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(drop, t + 0.085);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + decay + 0.02);

    // transient click so it cuts through on phone speakers
    const cl = this.noiseSource();
    const clf = ctx.createBiquadFilter();
    clf.type = "bandpass";
    clf.frequency.value = 2100;
    clf.Q.value = 0.9;
    const clg = ctx.createGain();
    clg.gain.setValueAtTime(gain * 0.35, t);
    clg.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    cl.connect(clf);
    clf.connect(clg);
    clg.connect(bus);
    cl.start(t);
    cl.stop(t + 0.04);
  }

  snare(t, { gain = 0.55, decay = 0.16, tone = 1900, bus = this.musicBus, send = 0.14 } = {}) {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = tone;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 480;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    n.start(t);
    n.stop(t + decay + 0.05);

    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(210, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(gain * 0.5, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    body.connect(bg);
    bg.connect(bus);
    body.start(t);
    body.stop(t + 0.1);
  }

  hat(t, { gain = 0.18, decay = 0.035, cutoff = 7600, bus = this.musicBus } = {}) {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(hp);
    hp.connect(g);
    g.connect(bus);
    n.start(t);
    n.stop(t + decay + 0.03);
  }

  bass(t, midi, dur, { gain = 0.5, cutoff = 900, type = "sawtooth", bus = this.musicBus } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = midiToHz(midi);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = midiToHz(midi - 12);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(cutoff * 2.1, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(cutoff, 90), t + Math.min(0.14, dur));

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const subG = ctx.createGain();
    subG.gain.value = 0.55;

    osc.connect(lp);
    lp.connect(g);
    sub.connect(subG);
    subG.connect(g);
    g.connect(bus);

    osc.start(t);
    sub.start(t);
    osc.stop(t + dur + 0.04);
    sub.stop(t + dur + 0.04);
  }

  pluck(t, midi, dur, { gain = 0.22, detune = 8, cutoff = 3200, send = 0.3, echo = 0.25, bus = this.musicBus } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.28, 400), t + dur);

    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiToHz(midi);
      o.detune.value = i === 0 ? -detune : detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.03);
    }
    lp.connect(g);
    g.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    if (echo > 0) {
      const e = ctx.createGain();
      e.gain.value = echo;
      g.connect(e);
      e.connect(this.delay);
    }
  }

  pad(t, midis, dur, { gain = 0.09, cutoff = 1500, send = 0.6, bus = this.musicBus } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;

    for (const m of midis) {
      for (let d = -1; d <= 1; d += 2) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiToHz(m);
        o.detune.value = d * 11;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
    lp.connect(g);
    g.connect(bus);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(this.reverb);
  }

  /** Short bright blip — used for UI and for the rank callouts. */
  blip(t, midi, { gain = 0.3, dur = 0.12, type = "square", send = 0.25, bus = this.sfxBus } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiToHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  sweep(t, from, to, dur, { gain = 0.24, type = "sawtooth", bus = this.sfxBus, send = 0.4 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  noiseBurst(t, { gain = 0.3, dur = 0.4, from = 9000, to = 200, q = 2, bus = this.sfxBus, send = 0.5 } = {}) {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(to, 40), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f);
    f.connect(g);
    g.connect(bus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.reverb);
    }
    n.start(t);
    n.stop(t + dur + 0.05);
  }
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Synthetic impulse response: noise shaped by an exponential decay. */
function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // slight pre-delay keeps the dry signal readable
      const shape = t < 0.012 ? t / 0.012 : 1;
      d[i] = (Math.random() * 2 - 1) * shape * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
