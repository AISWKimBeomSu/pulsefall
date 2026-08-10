// Gameplay capture.
//
// The submission rules for this build's competition are explicit: the play video must
// be the real screen, not an edit or a synthesis. So this records the actual canvas
// backing store and the actual audio graph output — the same pixels and the same
// samples the player just saw and heard, at full frame rate, with no post step where
// something could be faked. Screen-recording the browser would work too, but it costs
// frames, catches the OS cursor and the URL bar, and resamples the audio through the
// system mixer. Tapping the source is both more honest and better looking.

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

export class Recorder {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../audio/engine.js").AudioEngine} engine
   * @param {(msg: string, ms?: number) => void} [notify]
   */
  constructor(canvas, engine, notify) {
    this.canvas = canvas;
    this.engine = engine;
    this.notify = notify ?? (() => {});
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
    this.stopTimer = 0;
    this.badge = null;
    this._audioTap = null;
  }

  get active() {
    return !!this.rec && this.rec.state === "recording";
  }

  get supported() {
    return typeof MediaRecorder !== "undefined" && !!this.canvas.captureStream;
  }

  /**
   * @param {number} seconds hard stop, so a forgotten recording cannot run for an hour
   *   and produce a file too big to upload. 0 means manual stop only.
   */
  start(seconds = 0) {
    if (this.active) return false;
    if (!this.supported) {
      this.notify("이 브라우저는 녹화를 지원하지 않습니다", 3000);
      return false;
    }

    const mime = pickMime();
    const stream = this.canvas.captureStream(60);

    // The audio tap is a parallel branch off the final node, never in series with it,
    // so recording cannot change what comes out of the speakers.
    const ctx = this.engine.ctx;
    if (ctx && this.engine.finalNode) {
      if (!this._audioTap) {
        this._audioTap = ctx.createMediaStreamDestination();
        this.engine.finalNode.connect(this._audioTap);
      }
      for (const t of this._audioTap.stream.getAudioTracks()) stream.addTrack(t);
    }

    try {
      this.rec = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 192_000,
      });
    } catch {
      this.notify("녹화를 시작하지 못했습니다", 3000);
      this.rec = null;
      return false;
    }

    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this._save();
    this.rec.start(250);
    this.startedAt = performance.now();

    this._showBadge();
    if (seconds > 0) this.stopTimer = window.setTimeout(() => this.stop(), seconds * 1000);
    return true;
  }

  stop() {
    if (!this.rec) return;
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = 0; }
    if (this.rec.state !== "inactive") this.rec.stop();
    this._hideBadge();
  }

  toggle(seconds = 0) {
    if (this.active) this.stop();
    else this.start(seconds);
  }

  _save() {
    const type = this.rec?.mimeType || "video/webm";
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    this.rec = null;

    const secs = Math.round((performance.now() - this.startedAt) / 100) / 10;
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `pulsefall-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20_000);

    const mb = (blob.size / 1048576).toFixed(1);
    this.notify(`녹화 저장 · ${secs}초 · ${mb}MB`, 4200);
  }

  /* -- the little red dot -------------------------------------------------- */

  _showBadge() {
    if (this.badge) return;
    const el = document.createElement("div");
    el.className = "rec-badge";
    el.innerHTML = '<i></i><span>REC</span><b>0:00</b>';
    document.body.appendChild(el);
    this.badge = el;
    const clock = el.querySelector("b");
    this._tick = window.setInterval(() => {
      const s = Math.floor((performance.now() - this.startedAt) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 250);
  }

  _hideBadge() {
    if (this._tick) { clearInterval(this._tick); this._tick = 0; }
    this.badge?.remove();
    this.badge = null;
  }
}
