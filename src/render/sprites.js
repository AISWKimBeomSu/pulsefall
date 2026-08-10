// Pre-rendered glow sprites.
//
// The old build set ctx.shadowBlur inside the wall loop. Every draw call with a
// non-zero shadowBlur forces the browser to blur the whole surface, so a screen with
// fifteen gates paid for fifteen full-canvas blur passes per frame — that alone was
// most of the lag the player was feeling. Nothing in this project ever touches
// shadowBlur. Glow is a cached radial-gradient bitmap composited with 'lighter'.

const cache = new Map();
const MAX_CACHE = 48;

function makeGlow(color, size, falloff) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(0.18, applyAlpha(color, 0.65));
  grad.addColorStop(falloff, applyAlpha(color, 0.14));
  grad.addColorStop(1, applyAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Works for the hsl(...) strings the palette produces. */
function applyAlpha(color, a) {
  if (color.startsWith("hsl(")) {
    const inner = color.slice(4, -1).split("/")[0].trim();
    return `hsl(${inner} / ${a})`;
  }
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  return color;
}

export function getGlow(color, size = 128, falloff = 0.55) {
  const key = `${color}|${size}|${falloff}`;
  let s = cache.get(key);
  if (s) return s;
  if (cache.size > MAX_CACHE) {
    // Palettes drift slowly; a plain FIFO eviction is plenty.
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  s = makeGlow(color, size, falloff);
  cache.set(key, s);
  return s;
}

/** Additive glow blit centred on (x, y). */
export function blitGlow(ctx, color, x, y, radius, alpha = 1, size = 128) {
  if (alpha <= 0.004) return;
  const sprite = getGlow(color, size);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

export function clearSpriteCache() {
  cache.clear();
  vignette = null;
  vignetteKey = "";
}

let vignette = null;
let vignetteKey = "";

/**
 * Vignette, built once per resize at quarter resolution and stretched. Keeping it
 * here means the renderer itself never constructs a gradient — which is the rule the
 * smoke test enforces, because a gradient built inside draw() is a per-frame
 * allocation and the old build had one.
 */
export function getVignette(w, h) {
  const key = `${w}x${h}`;
  if (vignette && vignetteKey === key) return vignette;
  const cw = Math.max(2, Math.round(w / 4));
  const ch = Math.max(2, Math.round(h / 4));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d");
  const r = Math.max(cw, ch) * 0.72;
  const grad = g.createRadialGradient(cw / 2, ch / 2, r * 0.32, cw / 2, ch / 2, r);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.62, "rgba(0,0,0,0.24)");
  grad.addColorStop(1, "rgba(0,0,0,0.72)");
  g.fillStyle = grad;
  g.fillRect(0, 0, cw, ch);
  vignette = c;
  vignetteKey = key;
  return c;
}
