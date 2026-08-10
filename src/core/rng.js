// Deterministic PRNG. Charts must compile identically on every device and every
// retry — that is what makes a track memorizable instead of merely random.

/** mulberry32 — fast, good enough distribution, 32-bit state. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  /** Weighted pick. `items` is [{ w, ...}] — returns the item. */
  rng.weighted = (items) => {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i].w;
    let r = rng() * total;
    for (let i = 0; i < items.length; i++) {
      r -= items[i].w;
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  return rng;
}

/** FNV-1a — turns a challenge string like "PULSE-20260810" into a stable seed. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailySeedId(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `PULSE-${y}${m}${d}`;
}
