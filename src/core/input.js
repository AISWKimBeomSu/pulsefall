// Input. Two directions and one action, on every device.
//
// The critical rule, inherited from the genre and violated by the previous build:
// the cursor NEVER teleports to where you touched. You hold a side and it turns.
// Positional input would make the game trivial on touch and unplayable on keys.

export class Input {
  constructor(target = window) {
    this.left = false;
    this.right = false;
    this.pulseEdge = false;   // consumed once per press
    this.confirmEdge = false;
    this.backEdge = false;
    this.pauseEdge = false;
    this.anyEdge = false;
    this.lastKind = "key";    // 'key' | 'touch' | 'pad'

    this._touches = new Map();
    this._mouseButtons = new Set();
    this._pad = null;
    this._padPrev = { pulse: false, confirm: false, back: false, pause: false };
    this._el = target;
    this._bind();
  }

  get dir() {
    if (this.left === this.right) return 0;
    return this.left ? -1 : 1;
  }

  /** Call once per frame, after reading the edges. */
  endFrame() {
    this.pulseEdge = false;
    this.confirmEdge = false;
    this.backEdge = false;
    this.pauseEdge = false;
    this.anyEdge = false;
  }

  _bind() {
    const w = window;

    w.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.lastKind = "key";
      switch (e.code) {
        case "ArrowLeft": case "KeyA": this.left = true; e.preventDefault(); break;
        case "ArrowRight": case "KeyD": this.right = true; e.preventDefault(); break;
        case "Space": case "ArrowUp": case "ArrowDown": case "KeyW": case "KeyS":
        case "ShiftLeft": case "ShiftRight": case "KeyJ": case "KeyK":
          this.pulseEdge = true; this.confirmEdge = true; e.preventDefault(); break;
        case "Enter": case "NumpadEnter": this.confirmEdge = true; e.preventDefault(); break;
        case "Escape": this.pauseEdge = true; this.backEdge = true; e.preventDefault(); break;
        case "Backspace": this.backEdge = true; e.preventDefault(); break;
        default: break;
      }
      this.anyEdge = true;
    }, { passive: false });

    w.addEventListener("keyup", (e) => {
      switch (e.code) {
        case "ArrowLeft": case "KeyA": this.left = false; break;
        case "ArrowRight": case "KeyD": this.right = false; break;
        default: break;
      }
    });

    // Lose held keys when the window loses focus, or the player comes back stuck.
    w.addEventListener("blur", () => { this.left = false; this.right = false; });

    const el = this._el === window ? document.body : this._el;

    el.addEventListener("contextmenu", (e) => e.preventDefault());

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") {
        this.lastKind = "key";
        this._mouseButtons.add(e.button);
        if (e.button === 0) this.left = true;
        if (e.button === 2) this.right = true;
        if (e.button === 1) this.pulseEdge = true;
        this.anyEdge = true;
        return;
      }
      this.lastKind = "touch";
      const zone = this._zone(e.clientX);
      this._touches.set(e.pointerId, zone);
      if (zone === "pulse") this.pulseEdge = true;
      this._applyTouches();
      // Deliberately NOT confirmEdge. On a menu screen that would fire the highlighted
      // item on any stray tap; touch users press the buttons themselves, and the boot
      // screen listens on anyEdge.
      this.anyEdge = true;
      e.preventDefault();
    }, { passive: false });

    const release = (e) => {
      if (e.pointerType === "mouse") {
        this._mouseButtons.delete(e.button);
        if (e.button === 0) this.left = false;
        if (e.button === 2) this.right = false;
        return;
      }
      this._touches.delete(e.pointerId);
      this._applyTouches();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);

    // Dragging across the zone boundary re-assigns without lifting a finger.
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") return;
      if (!this._touches.has(e.pointerId)) return;
      const zone = this._zone(e.clientX);
      const prev = this._touches.get(e.pointerId);
      if (zone !== prev && zone !== "pulse") {
        this._touches.set(e.pointerId, zone);
        this._applyTouches();
      }
    }, { passive: true });
  }

  _zone(clientX) {
    const w = window.innerWidth;
    const centerW = w * 0.24;
    const x0 = (w - centerW) / 2;
    if (clientX < x0) return "left";
    if (clientX > x0 + centerW) return "right";
    return "pulse";
  }

  _applyTouches() {
    let l = false;
    let r = false;
    for (const z of this._touches.values()) {
      if (z === "left") l = true;
      else if (z === "right") r = true;
    }
    this.left = l;
    this.right = r;
  }

  /** Gamepads have no events; poll them from the frame callback. */
  pollGamepad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return;

    const ax = pad.axes[0] ?? 0;
    const dpadL = pad.buttons[14]?.pressed;
    const dpadR = pad.buttons[15]?.pressed;
    const l = dpadL || ax < -0.35;
    const r = dpadR || ax > 0.35;
    if (l || r) this.lastKind = "pad";
    if (this._touches.size === 0 && this._mouseButtons.size === 0) {
      if (l || r || this._padHeld) {
        this.left = l;
        this.right = r;
        this._padHeld = l || r;
      }
    }

    const pulse = pad.buttons[0]?.pressed || pad.buttons[1]?.pressed ||
      pad.buttons[5]?.pressed || pad.buttons[7]?.pressed;
    const back = pad.buttons[2]?.pressed;
    const pause = pad.buttons[9]?.pressed;

    if (pulse && !this._padPrev.pulse) { this.pulseEdge = true; this.confirmEdge = true; this.anyEdge = true; }
    if (back && !this._padPrev.back) { this.backEdge = true; this.anyEdge = true; }
    if (pause && !this._padPrev.pause) { this.pauseEdge = true; this.anyEdge = true; }

    this._padPrev.pulse = pulse;
    this._padPrev.back = back;
    this._padPrev.pause = pause;
  }
}
