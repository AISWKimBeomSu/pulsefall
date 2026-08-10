// Smoke tests + headless playability verification.
//
// The interesting part is the bot at the bottom. It plays every compiled chart at
// 240 Hz with no rendering and reports how far it gets. A chart the bot cannot clear
// is a chart that will feel unfair to a human, and "unfair" is the failure mode that
// makes people delete an arcade game. This is the automated version of the
// "1000 runs, zero tunnelling" check in the research notes.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { TRACKS, makeEndlessTrack } from "../src/game/tracks.js";
import { compileChart } from "../src/game/chart.js";
import { World } from "../src/game/world.js";
import { makeRng, hashString, dailySeedId } from "../src/core/rng.js";
import { TAU } from "../src/core/mathx.js";
import {
  PLAYER_R, BASE_WALL_SPEED, PLAYER_SPEED, BEAT_WINDOW, PLAYER_HALF_W, PULSE_COST,
} from "../src/game/constants.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TICK = 1 / 240;

let failures = 0;
let checks = 0;

function ok(cond, label, detail = "") {
  checks++;
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  \x1b[31m${detail}\x1b[0m` : ""}`);
  }
}

function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

/* ========================================================================== */
section("files");

const REQUIRED = [
  "index.html", "styles.css", "server.js", "package.json",
  "public/manifest.webmanifest", "public/favicon.svg",
  "public/icons/icon-192.png", "public/icons/icon-512.png",
  "src/main.js", "src/core/loop.js", "src/core/input.js", "src/core/rng.js",
  "src/core/mathx.js", "src/core/storage.js",
  "src/audio/engine.js", "src/audio/music.js", "src/audio/sfx.js",
  "src/game/tracks.js", "src/game/chart.js", "src/game/patterns.js",
  "src/game/world.js", "src/game/constants.js",
  "src/render/renderer.js", "src/render/palette.js", "src/render/sprites.js",
  "src/ui/ui.js",
];

for (const f of REQUIRED) {
  const p = resolve(ROOT, f);
  ok(existsSync(p) && statSync(p).size > 0, f, existsSync(p) ? `${statSync(p).size}b` : "missing");
}

/* ========================================================================== */
section("syntax");

function walkJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkJs(p));
    else if (extname(p) === ".js" || extname(p) === ".mjs") out.push(p);
  }
  return out;
}

const jsFiles = [...walkJs(resolve(ROOT, "src")), resolve(ROOT, "server.js")];
let syntaxOk = true;
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    syntaxOk = false;
    console.log(`      ${f}: ${e.stderr?.toString().split("\n")[0]}`);
  }
}
ok(syntaxOk, "node --check on every module", `${jsFiles.length} files`);

/* ========================================================================== */
section("performance regressions");

const srcBlob = jsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
// Comments are allowed to name the banned API — several of them exist precisely to
// explain why it is banned. Only real code counts, so strip comments before testing.
const codeBlob = srcBlob.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

ok(!/shadowBlur/.test(codeBlob),
  "no ctx.shadowBlur anywhere",
  "each shadowBlur draw costs a full-surface blur pass");
ok(!/ctx\.filter\s*=/.test(codeBlob), "no ctx.filter");
ok(!/createRadialGradient|createLinearGradient/.test(readFileSync(resolve(ROOT, "src/render/renderer.js"), "utf8")),
  "renderer builds no gradients per frame", "gradients live in the sprite cache");
ok(/TICK_HZ\s*=\s*240/.test(readFileSync(resolve(ROOT, "src/core/loop.js"), "utf8")),
  "simulation runs on a fixed 240 Hz tick");

const worldSrc = readFileSync(resolve(ROOT, "src/game/world.js"), "utf8");
ok(/POOL_SIZE/.test(worldSrc) && /_take\(\)/.test(worldSrc), "walls come from a pool", "no allocation in the hot loop");

const inputSrc = readFileSync(resolve(ROOT, "src/core/input.js"), "utf8");
ok(!/angle\s*=\s*Math\.atan2/.test(inputSrc), "input never teleports the cursor to a touch point");

/* ========================================================================== */
section("chart compilation");

const charts = [];
for (const t of TRACKS) {
  const c = compileChart(t, hashString(t.id));
  charts.push({ track: t, chart: c });

  ok(c.walls.length > 40, `${t.name}: walls compiled`, `${c.walls.length} walls`);
  ok(c.duration > 45 && c.duration < 200, `${t.name}: duration sane`, `${c.duration.toFixed(1)}s`);

  let sorted = true;
  let finite = true;
  let minThick = Infinity;
  let maxSpeed = 0;
  for (let i = 0; i < c.walls.length; i++) {
    const w = c.walls[i];
    if (i && w.spawnTime < c.walls[i - 1].spawnTime - 1e-6) sorted = false;
    if (!Number.isFinite(w.spawnTime) || !Number.isFinite(w.time) || !Number.isFinite(w.thick)) finite = false;
    if (w.span < 1 || w.span > w.sides) finite = false;
    minThick = Math.min(minThick, w.thick);
    maxSpeed = Math.max(maxSpeed, w.speed);
  }
  ok(sorted, `${t.name}: spawn order is monotonic`);
  ok(finite, `${t.name}: no NaN / degenerate walls`);

  // Tunnelling guard: a wall must never cross the cursor band inside one tick.
  const perTick = BASE_WALL_SPEED * maxSpeed * TICK;
  ok(minThick > perTick * 3, `${t.name}: no tunnelling possible`,
    `thinnest wall ${minThick.toFixed(4)} vs ${perTick.toFixed(5)}/tick`);
}

const dailySeed = dailySeedId();
const dailyTrack = makeEndlessTrack(makeRng(hashString(dailySeed)), { bars: 96, bpm: 132 });
const dailyChart = compileChart(dailyTrack, hashString(dailySeed));
charts.push({ track: dailyTrack, chart: dailyChart, label: "DAILY" });
ok(dailyChart.walls.length > 100, "daily chart compiles", `${dailyChart.walls.length} walls`);

// Determinism: same input, same output, forever.
const a = compileChart(TRACKS[0], hashString(TRACKS[0].id));
const b = compileChart(TRACKS[0], hashString(TRACKS[0].id));
ok(JSON.stringify(a.walls) === JSON.stringify(b.walls), "charts are deterministic");

/* ========================================================================== */
section("playability (headless autoplay)");

/**
 * A deliberately unclever bot: it looks at the nearest incoming ring, steers to the
 * closest gap at full speed, and pulses when there is no gap or no time. If this can
 * clear a chart, a practised human can too — and anything it cannot clear is a
 * fairness bug in the chart, not a skill check.
 */
function runBot(chart, { maxSeconds = 400 } = {}) {
  const world = new World();
  world.reset(chart, { startTime: 0 });
  world.start();

  const SAMPLES = 180;
  const blocked = new Uint8Array(SAMPLES);
  let steps = 0;
  const limit = Math.ceil(Math.min(chart.duration + 2, maxSeconds) / TICK);

  while (world.status === "running" && steps++ < limit) {
    decide(world, blocked, SAMPLES);
    world.step(TICK);
    world.events.length = 0;
  }
  return {
    progress: world.progress,
    status: world.status,
    graze: world.grazeCount,
    pulses: world.pulseCount,
    perfect: world.perfectCount,
    heat: world.heat,
    score: world.score,
    deathAt: world.status === "dead" ? world.songTime : null,
  };
}

function decide(world, blocked, SAMPLES) {
  // 1. isolate the nearest ring still ahead of the cursor
  let lead = Infinity;
  for (const w of world.walls) {
    if (w.dist + w.thick <= PLAYER_R) continue;
    if (w.dist < lead) lead = w.dist;
  }

  if (!Number.isFinite(lead)) {
    world.setDir(0);
    return;
  }

  const band = lead + 0.075;
  blocked.fill(0);
  let group = 0;
  let groupSpeed = 1;
  for (const w of world.walls) {
    if (w.dist + w.thick <= PLAYER_R || w.dist > band) continue;
    if (w.kind === "bonus") continue;
    group++;
    groupSpeed = Math.max(groupSpeed, w.speed);
    const step = TAU / w.sides;
    const a0 = w.a0;
    const a1 = a0 + w.span * step;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * TAU;
      let rel = (a - a0) % TAU;
      if (rel < 0) rel += TAU;
      if (rel < a1 - a0) blocked[i] = 1;
    }
  }

  // The cursor is a wedge, not a point. Dilate the blocked set by its half-width
  // (plus one sample of slack) so "free" means free for the whole cursor.
  const grow = Math.ceil(PLAYER_HALF_W / (TAU / SAMPLES)) + 1;
  if (group > 0 && grow > 0) {
    const src = Uint8Array.from(blocked);
    for (let i = 0; i < SAMPLES; i++) {
      if (!src[i]) continue;
      for (let k = -grow; k <= grow; k++) blocked[(i + k + SAMPLES) % SAMPLES] = 1;
    }
  }

  const eta = Math.max((lead - PLAYER_R) / (BASE_WALL_SPEED * groupSpeed), 0.0001);

  // 2. nearest free sample, measured in angular distance
  const pa = world.angle;
  let bestIdx = -1;
  let bestCost = Infinity;
  let bestTravel = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    if (blocked[i]) continue;
    // Prefer roomy gaps slightly, so the bot does not wedge itself into a slot it
    // will have to leave immediately.
    let room = 0;
    for (let k = 1; k <= 6; k++) {
      if (blocked[(i + k) % SAMPLES] && blocked[(i - k + SAMPLES) % SAMPLES]) break;
      room++;
    }
    const a = (i / SAMPLES) * TAU;
    let d = (a - pa) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    const travel = Math.abs(d);
    const cost = travel - room * 0.018;
    if (cost < bestCost) { bestCost = cost; bestIdx = i; bestTravel = travel; }
  }

  const reachable = bestIdx >= 0 && bestTravel < PLAYER_SPEED * eta * 0.92;

  // 3. pulse when there is nowhere to be, or nowhere reachable in time.
  //
  // The gate here has to be the world's gate, not a stricter guess at it. The world
  // never refuses an on-beat pulse (see ONBEAT_ALWAYS_ALLOWED and World._updatePulse)
  // — that rule is the whole reason a sealed ring is fair. A bot that demands a full
  // charge before it will even ask sits still in front of a seal it was entitled to
  // pass, dies, and reports the CHART as unfair. That is a lie about the chart, and
  // the most dangerous kind of test failure: one that sends you fixing the wrong file.
  const onBeat = world.beatError() <= BEAT_WINDOW;
  if (group > 0 && (bestIdx < 0 || !reachable) && world.pulseTimer <= 0) {
    if ((onBeat || world.charge >= PULSE_COST) && eta < 0.34) world.requestPulse();
  }

  if (bestIdx < 0) {
    world.setDir(0);
    return;
  }

  const target = (bestIdx / SAMPLES) * TAU;
  let d = (target - pa) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;

  // Hug the gap edge rather than the centre — that is where a human plays, and it
  // makes the bot exercise the graze path instead of coasting down the middle.
  const dead = 0.02;
  world.setDir(Math.abs(d) < dead ? 0 : d > 0 ? 1 : -1);
}

for (const { track, chart, label } of charts) {
  const r = runBot(chart);
  const pct = (r.progress * 100).toFixed(1);
  const name = label || track.name;
  ok(r.progress > 0.985, `${name}: bot clears the chart`,
    `${pct}%  graze ${r.graze}  pulse ${r.pulses}  heat ×${r.heat.toFixed(1)}` +
    (r.deathAt !== null ? `  died @${r.deathAt.toFixed(1)}s` : ""));
}

// Endless mode has no author to check it, so verify a batch of random seeds.
let endlessOk = 0;
const ENDLESS_RUNS = 6;
let endlessMin = 1;
for (let i = 0; i < ENDLESS_RUNS; i++) {
  const rng = makeRng(1000 + i * 7919);
  const t = makeEndlessTrack(rng, { bars: 120 });
  const c = compileChart(t, 1000 + i * 7919);
  const r = runBot(c);
  if (r.progress > 0.985) endlessOk++;
  endlessMin = Math.min(endlessMin, r.progress);
}
ok(endlessOk === ENDLESS_RUNS, "endless: every seed is survivable",
  `${endlessOk}/${ENDLESS_RUNS}, worst ${(endlessMin * 100).toFixed(1)}%`);

/* ========================================================================== */
section("html wiring");

const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
for (const id of [
  "stage", "hud", "progFill", "hudPct", "hudScore", "hudHeat", "hudChain",
  "callout", "toast", "boot", "title", "tracks", "howto", "settings", "pause",
  "result", "trackMenu", "practiceMarks", "resPct", "resScore",
]) {
  ok(html.includes(`id="${id}"`), `#${id} present`);
}
ok(html.includes('type="module"') && html.includes("src/main.js"), "module entry wired");

// Numbers quoted in the how-to screen drift away from the constants the moment you
// tune anything. Anything marked data-const must still match the real value.
{
  const consts = await import("../src/game/constants.js");
  const quoted = [...html.matchAll(/data-const="([A-Z_]+)"[^>]*>([\d.]+)</g)];
  ok(quoted.length > 0, "how-to quotes at least one live constant");
  for (const [, name, shown] of quoted) {
    ok(Math.abs(Number(shown) - consts[name]) < 1e-9,
      `how-to text matches ${name}`, `shows ${shown}, actual ${consts[name]}`);
  }
}

const uiSrc = readFileSync(resolve(ROOT, "src/ui/ui.js"), "utf8");
const referenced = [...uiSrc.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]);
const missing = [...new Set(referenced)].filter((id) => !html.includes(`id="${id}"`));
ok(missing.length === 0, "every element UI looks up exists in the HTML", missing.join(", "));

/* ========================================================================== */

console.log(
  failures === 0
    ? `\n\x1b[32m  ${checks} checks passed\x1b[0m\n`
    : `\n\x1b[31m  ${failures} of ${checks} checks FAILED\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
