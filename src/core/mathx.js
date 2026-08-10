// Small math helpers. Kept allocation-free — every one of these runs in the hot loop.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return b === a ? 0 : (v - a) / (b - a);
}

/** Frame-rate independent exponential approach. `rate` = how much of the gap is closed per second. */
export function damp(a, b, rate, dt) {
  return b + (a - b) * Math.exp(-rate * dt);
}

export function wrapTau(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** Signed shortest angular delta from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleDist(a, b) {
  return Math.abs(angleDelta(a, b));
}

export function smoothstep(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Ease used for pulse/dash falloff — fast out, slow settle. */
export function easeOutCubic(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeOutQuint(t) {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u * u * u;
}
