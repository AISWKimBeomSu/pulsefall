// Dependency-free PNG icon generator. Draws the mark procedurally into an RGBA
// buffer and encodes it with node's built-in zlib — no image library, nothing to
// install, and the icons regenerate identically on any machine.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = resolve(ROOT, "public/icons");
mkdirSync(OUT, { recursive: true });

/* ---------- tiny PNG encoder --------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- the mark ------------------------------------------------------ */

function polygonSdf(px, py, n, r, rot) {
  // distance from point to a regular n-gon boundary (approximate, good enough at
  // icon resolutions with 4x supersampling)
  const step = (Math.PI * 2) / n;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a0 = i * step + rot;
    const a1 = a0 + step;
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
    const dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)));
    const cxp = x0 + dx * t, cyp = y0 + dy * t;
    best = Math.min(best, Math.hypot(px - cxp, py - cyp));
  }
  return best;
}

function render(size) {
  const S = 3; // supersample
  const W = size * S;
  const buf = Buffer.alloc(size * size * 4);
  const acc = new Float32Array(size * size * 4);

  const R = W * 0.38;
  const ringW = W * 0.05;
  const coreR = W * 0.135;
  const cx = W / 2, cy = W / 2;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = x - cx, py = y - cy;
      const dist = Math.hypot(px, py);

      // background with a warm centre bloom
      let r = 7, g = 6, b = 10;
      const bloom = Math.max(0, 1 - dist / (W * 0.55));
      r += bloom * bloom * 46; g += bloom * bloom * 22; b += bloom * bloom * 34;

      // outer hexagon ring (gap on the upper-right side, echoing a pass lane)
      const ang = Math.atan2(py, px);
      const sideIdx = Math.floor((((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 6);
      const dRing = polygonSdf(px, py, 6, R, -Math.PI / 2);
      if (dRing < ringW && sideIdx !== 4) {
        const k = 1 - dRing / ringW;
        r = lerp(r, 255, k); g = lerp(g, 155 + 60 * k, k); b = lerp(b, 70, k);
      }

      // core hexagon
      const dCore = polygonSdf(px, py, 6, coreR, -Math.PI / 2);
      const insideCore = dist < coreR * 0.92;
      if (insideCore || dCore < W * 0.016) {
        const k = insideCore ? 1 : 1 - dCore / (W * 0.016);
        r = lerp(r, 255, k * 0.9); g = lerp(g, 209, k * 0.9); b = lerp(b, 102, k * 0.9);
      }

      // player cursor: a small white triangle just outside the core, pointing up
      const tx = px, ty = py + coreR * 1.95;
      if (ty > -W * 0.055 && ty < 0 && Math.abs(tx) < (-ty) * 0.72) {
        r = 255; g = 255; b = 255;
      }

      // rounded-square mask
      const q = Math.max(Math.abs(px), Math.abs(py));
      const corner = W * 0.22;
      const inx = Math.max(0, Math.abs(px) - (W / 2 - corner));
      const iny = Math.max(0, Math.abs(py) - (W / 2 - corner));
      const outside = Math.hypot(inx, iny) > corner || q > W / 2;
      const a = outside ? 0 : 255;

      const ox = Math.floor(x / S), oy = Math.floor(y / S);
      const oi = (oy * size + ox) * 4;
      acc[oi] += r; acc[oi + 1] += g; acc[oi + 2] += b; acc[oi + 3] += a;
    }
  }

  const n = S * S;
  for (let i = 0; i < acc.length; i++) buf[i] = Math.max(0, Math.min(255, Math.round(acc[i] / n)));
  return encodePng(size, size, buf);
}

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["app-icon-1024.png", 1024],
]) {
  const png = render(size);
  writeFileSync(resolve(OUT, name), png);
  console.log(`  ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
console.log(`\n  icons written to ${OUT}\n`);
