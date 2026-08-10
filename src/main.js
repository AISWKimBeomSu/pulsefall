// PULSEFALL — entry point.
//
// Owns the state machine, wires the simulation to audio/render/UI, and keeps the
// frame budget honest by dialling render quality down before the player ever feels
// a stutter.

import { createLoop } from "./core/loop.js";
import { Input } from "./core/input.js";
import { Recorder } from "./core/recorder.js";
import { store } from "./core/storage.js";
import { makeRng, hashString, dailySeedId } from "./core/rng.js";
import { clamp } from "./core/mathx.js";

import { AudioEngine } from "./audio/engine.js";
import { MusicPlayer } from "./audio/music.js";
import { Sfx } from "./audio/sfx.js";

import { TRACKS, getTrack, makeEndlessTrack } from "./game/tracks.js";
import { compileChart } from "./game/chart.js";
import { World } from "./game/world.js";
import { DEATH_FREEZE } from "./game/constants.js";

import { Renderer } from "./render/renderer.js";
import { Palette } from "./render/palette.js";
import { UI } from "./ui/ui.js";

/* ========================================================================== */

const canvas = document.getElementById("stage");
const engine = new AudioEngine();
const music = new MusicPlayer(engine);
const sfx = new Sfx(engine);
const world = new World();
const renderer = new Renderer(canvas);
const palette = new Palette("ember");
const input = new Input(document.body);

const state = {
  screen: "boot",       // boot | title | tracks | howto | settings | playing | paused | result
  mode: "track",        // track | daily | endless
  trackId: TRACKS[0].id,
  seedId: "",
  seed: 0,
  chart: null,
  track: null,
  startAt: 0,
  practice: false,
  runs: 0,
  hintShown: new Set(),
  zoneHintTimer: 0,
  qualityCheck: 0,
  qualityHold: 0,
  debug: new URLSearchParams(location.search).has("debug"),
};

// The play video for the submission has to land between 30 and 60 seconds. The hard
// stop sits just past that so there is something to trim rather than something to
// re-shoot, and so a recording nobody remembers starting cannot eat the disk.
const RECORD_LIMIT = Number(new URLSearchParams(location.search).get("rec")) || 70;

const ui = new UI({ onAction: handleAction });
const recorder = new Recorder(canvas, engine, (m, ms) => ui.toast(m, ms));

/* ========================================================================== */
/* boot                                                                       */

function applySettings() {
  const s = store.data.settings;
  engine.setMusicVolume(s.music);
  if (engine.ctx) engine.sfxBus.gain.value = s.sfx;
  engine.setMuted(s.muted);
  renderer.reducedMotion = renderer.reducedMotion || !s.shake;
  const m = document.getElementById("setMusic");
  const f = document.getElementById("setSfx");
  const k = document.getElementById("setShake");
  if (m) m.value = Math.round(s.music * 100);
  if (f) f.value = Math.round(s.sfx * 100);
  if (k) k.checked = s.shake;
}

document.getElementById("setMusic")?.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  store.setSetting("music", v);
  engine.setMusicVolume(v);
});
document.getElementById("setSfx")?.addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  store.setSetting("sfx", v);
  if (engine.ctx) engine.sfxBus.gain.setTargetAtTime(v, engine.now, 0.05);
});
document.getElementById("setShake")?.addEventListener("change", (e) => {
  store.setSetting("shake", e.target.checked);
  renderer.reducedMotion = !e.target.checked ||
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
});

function boot() {
  engine.init();
  applySettings();
  // A first-time player who lands on the menu and picks a track has been told nothing.
  // They die in four seconds to a rule they were never shown, and conclude the game is
  // unfair rather than that they are new. So the first visit — and only the first —
  // routes through the rules, which end in a button that starts the easiest track.
  if (!store.data.seenIntro) {
    music.stop();
    state.screen = "howto";
    ui.setHudVisible(false);
    ui.show("howto");
    playMenuBed();
    return;
  }
  goTitle();
}

function goTitle() {
  music.stop();
  state.screen = "title";
  ui.setHudVisible(false);
  ui.show("title");
  ui.updateModeMeta(store, TRACKS);
  const sid = dailySeedId();
  ui.setDailyMeta(sid, store.daily(sid));
  // Menu music: a slow, quiet version of track one so the title is never silent.
  playMenuBed();
}

let menuBedTrack = null;
function playMenuBed() {
  if (!menuBedTrack) {
    const base = TRACKS[0];
    menuBedTrack = {
      ...base,
      id: "menu-bed",
      bpm: 96,
      sections: [
        { name: "BED", bars: 64, prog: [0, 5, 2, 6], pad: true, padGain: 0.09, padCutoff: 1100,
          drums: { kick: "x.......x.......", snare: "", hat: "" },
          bass: "0-------5-------", arp: "0...2...4...2...", arpGain: 0.11, arpEcho: 0.4,
          sides: 6, speed: 1, sub: 2, pool: ["barrage"] },
      ],
    };
  }
  music.play(menuBedTrack, { leadIn: 0.05 });
}

/* ========================================================================== */
/* run lifecycle                                                              */

function buildRun({ mode, trackId, seedId }) {
  let track;
  let seed;

  if (mode === "endless") {
    seed = (Math.random() * 0xffffffff) >>> 0;
    track = makeEndlessTrack(makeRng(seed));
  } else if (mode === "daily") {
    seed = hashString(seedId);
    const rng = makeRng(seed);
    const bpm = 124 + rng.int(0, 8) * 4;
    track = makeEndlessTrack(rng, { bars: 96, bpm });
    track.id = "daily";
    track.name = "DAILY PULSE";
    track.tag = seedId;
    track.palette = ["ember", "violet", "void", "endless"][rng.int(0, 3)];
    track.endless = false;
  } else {
    track = getTrack(trackId);
    seed = hashString(track.id);
  }

  const chart = compileChart(track, seed);
  state.mode = mode;
  state.track = track;
  state.chart = chart;
  state.seed = seed;
  state.seedId = seedId || track.id;
  state.trackId = track.id;

  palette.setTheme(track.palette);
  palette.prevIndex = palette.index = 0;
  palette.t = 1;
  palette._dirty = true;

  return chart;
}

/**
 * `startAt` is a fraction of the track (practice mode). It is passed explicitly
 * rather than read off `state`, because routing it through shared state is how it
 * silently got clobbered by a default parameter the first time around.
 */
function startRun(opts) {
  const startAt = opts.startAt ?? 0;
  state.startAt = startAt;
  state.practice = startAt > 0.001;

  const chart = state.chart && opts.reuse ? state.chart : buildRun(opts);
  const startTime = clamp(startAt * chart.duration - (state.practice ? 1.2 : 0), 0, Math.max(0, chart.duration - 2));

  world.reset(chart, { startTime });
  world.start();
  renderer.beatRings.length = 0;
  for (let i = 0; i < renderer.plife.length; i++) renderer.plife[i] = 0;

  music.play(state.track, { fromBeat: startTime / chart.spb, leadIn: 0.1 });
  music.onSection = null;

  state.screen = "playing";
  state.runs++;
  state.hintShown.clear();
  state.zoneHintTimer = input.lastKind === "touch" && state.runs <= 2 ? 3.2 : 0;

  ui.hideAll();
  ui.setHudVisible(true);
  ui.setSection("");
  ui._lastPct = -1;
  ui._lastScore = -1;
  if (!store.data.seenIntro) {
    store.markIntroSeen();
    ui.toast("좌우로 돌리고 · 중앙/SPACE 로 뚫는다", 2600);
  }
}

function retry() {
  startRun({ reuse: true, mode: state.mode, trackId: state.trackId, seedId: state.seedId });
}

function bestPctForRun() {
  if (state.mode === "endless") return 0;
  if (state.mode === "daily") return store.daily(state.seedId).bestPct;
  return store.track(state.trackId).bestPct;
}

function finishRun(cleared) {
  music.stop();
  const pct = cleared ? 1 : world.progress;
  const id = state.mode === "daily" ? state.seedId : state.trackId;
  const prevBest = bestPctForRun();

  const broke = state.practice
    ? { pct: false, score: false, chain: false, firstClear: false }
    : store.recordRun(state.mode, id, {
        pct, score: world.score, chain: world.bestChain, cleared, time: world.runTime,
      });

  state.screen = "result";
  ui.setHudVisible(false);
  ui.showResult({
    pct, score: world.score, chain: world.bestChain,
    graze: world.grazeCount, perfect: world.perfectCount,
    cleared, broke, bestPct: prevBest, mode: state.mode,
    practiceMax: state.mode === "track" ? store.track(state.trackId).practiceMax : 0,
  });

  if (cleared) sfx.clear();
  else if (broke.pct || broke.score) sfx.best();
  playMenuBed();
}

/* ========================================================================== */
/* actions from the UI                                                        */

function handleAction(a) {
  switch (a.type) {
    case "boot":
      boot();
      sfx.uiConfirm();
      break;

    case "mode":
      sfx.uiConfirm();
      if (a.mode === "tracks") {
        ui.buildTracks(TRACKS, store);
        state.screen = "tracks";
        ui.show("tracks");
      } else if (a.mode === "daily") {
        startRun({ mode: "daily", seedId: dailySeedId() });
      } else if (a.mode === "endless") {
        startRun({ mode: "endless" });
      } else if (a.mode === "quickstart") {
        startRun({ mode: "track", trackId: TRACKS[0].id });
      } else if (a.mode === "howto") {
        state.screen = "howto";
        ui.show("howto");
      } else if (a.mode === "settings") {
        state.screen = "settings";
        applySettings();
        ui.show("settings");
      }
      break;

    case "track":
      sfx.uiConfirm();
      startRun({ mode: "track", trackId: a.id });
      break;

    case "back":
      sfx.uiMove();
      if (a.to === "title") goTitle();
      break;

    case "pause":
      if (a.action === "resume") resume();
      else if (a.action === "restart") { sfx.uiConfirm(); retry(); }
      else { sfx.uiMove(); goTitle(); }
      break;

    case "result":
      if (a.action === "retry") { sfx.uiConfirm(); state.startAt = 0; state.practice = false; retry(); }
      else if (a.action === "practice") { sfx.uiMove(); ui.togglePracticeRow(); }
      else if (a.action === "share") shareResult();
      else { sfx.uiMove(); goTitle(); }
      break;

    case "practice":
      sfx.uiConfirm();
      state.startAt = a.at;
      state.practice = a.at > 0.001;
      retry();
      break;

    case "resetProgress":
      store.reset();
      applySettings();
      ui.toast("PROGRESS RESET");
      break;

    default: break;
  }
}

async function shareResult() {
  const pct = Math.floor((state.screen === "result" ? world.progress : 0) * 100);
  const filled = Math.round(pct / 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  const label = state.mode === "daily" ? `DAILY ${state.seedId.slice(-8)}` : state.track?.name ?? "PULSEFALL";
  const text =
    `PULSEFALL — ${label}\n` +
    `${pct}%  ·  ${Math.floor(world.score).toLocaleString("en-US")} pts  ·  ${world.bestChain} chain\n` +
    `${bar}\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      ui.toast("결과를 복사했습니다");
    }
  } catch {
    ui.toast("공유를 취소했습니다");
  }
}

/* ========================================================================== */
/* pause                                                                      */

function pause() {
  if (state.screen !== "playing" || world.status !== "running") return;
  state.screen = "paused";
  music.stop();
  ui.setHudVisible(false);
  ui.show("pause");
}

function resume() {
  if (state.screen !== "paused") return;
  state.screen = "playing";
  ui.hideAll();
  ui.setHudVisible(true);
  // Rewind a beat so the player is not dropped straight into a wall.
  const back = Math.max(0, world.songTime - state.chart.spb * 2);
  world.songTime = back;
  world._spawnIdx = 0;
  world.walls.length = 0;
  for (const w of world.pool) w.active = false;
  while (world._spawnIdx < state.chart.walls.length &&
         state.chart.walls[world._spawnIdx].spawnTime < back) world._spawnIdx++;
  music.play(state.track, { fromBeat: back / state.chart.spb, leadIn: 0.12 });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.screen === "playing") pause();
});

/* ========================================================================== */
/* world events -> feedback                                                   */

function drainEvents(dt) {
  const evs = world.events;
  if (!evs.length) return;
  const c = palette.c;
  const p = renderer.playerScreen(world);

  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    switch (e.type) {
      case "graze": {
        sfx.graze(e.chain);
        renderer.burst(p.x, p.y, 3 + Math.round(e.quality * 4), 130 * (0.5 + e.quality), c.wallGraze,
          { size: 7, life: 0.32 });
        if (e.chain === 10) ui.callout("CHAIN 10", { tiny: true, color: c.wallGraze });
        else if (e.chain > 0 && e.chain % 25 === 0) ui.callout(`CHAIN ${e.chain}`, { tiny: true, color: c.wallGraze });
        break;
      }
      case "pulse": {
        sfx.pulse(e.perfect);
        renderer.addBeatRing(e.perfect ? 1.6 : 0.9, e.perfect ? c.pulse : c.charge);
        renderer.burst(p.x, p.y, e.perfect ? 18 : 10, e.perfect ? 300 : 190,
          e.perfect ? c.pulse : c.charge, { size: e.perfect ? 13 : 9, life: 0.5 });
        if (e.perfect) ui.callout("ON BEAT", { tiny: true, color: c.pulse });
        renderer.impact(e.perfect ? 1 : 0.5);
        break;
      }
      case "pulseFail":
        sfx.pulseFail();
        break;
      case "bonus":
        sfx.charge(2);
        renderer.burst(p.x, p.y, 14, 210, c.bonusEdge, { size: 11, life: 0.55 });
        break;
      case "chargeFull":
        sfx.charge(e.level);
        break;
      case "heatTier":
        if (e.tier >= 3) {
          sfx.heatTier(e.tier);
          if (e.tier === 3 || e.tier === 5 || e.tier === 7) {
            ui.callout(`HEAT ×${e.tier}`, { tiny: true, color: c.charge });
          }
        }
        break;
      case "beat":
        renderer.addBeatRing(0.5, c.coreEdge);
        renderer.beatPulse(1);
        break;
      case "section": {
        const s = e.section;
        palette.goto(s.palette ?? e.index);
        ui.setSection(s.name);
        sfx.section(e.index);
        if (e.index > 0) ui.callout(s.name);
        // Swing the camera on the boundary, harder for the sections that are actually
        // a step up. The first section is the calm one — it gets no swing at all, so
        // the first real one lands as a change instead of as the baseline.
        if (e.index > 0) {
          const step = Math.min(1.35, 0.55 + (s.speed - 1) * 0.9 + (s.spin ? 0.35 : 0));
          renderer.sectionSwing(step);
        }
        const hint = s.raw?.hint;
        if (hint && !state.hintShown.has(hint)) {
          state.hintShown.add(hint);
          setTimeout(() => ui.toast(HINTS[hint] ?? hint, 2200), 900);
        }
        break;
      }
      case "death": {
        sfx.death();
        renderer.burst(p.x, p.y, 34, 420, c.player, { size: 14, life: 0.85 });
        renderer.burst(p.x, p.y, 18, 260, c.wallEdge, { size: 18, life: 1.1 });
        break;
      }
      case "clear":
        break;
      default: break;
    }
  }
  evs.length = 0;
}

const HINTS = {
  GRAZE: "벽 모서리를 스칠수록 게이지가 찬다",
  PULSE: "틈이 없는 링은 SPACE / 화면 중앙으로 뚫는다",
  PENTA: "5각형 — 좌우 거리가 다르다",
  QUAD: "4각형 — 한 칸이 멀다",
  TRIAD: "3각형 — 모든 선택이 되돌릴 수 없다",
  BREATHE: "숨 고르는 구간. 게이지를 채워라",
};

/* ========================================================================== */
/* loop                                                                       */

const loop = createLoop({
  step(dt) {
    if (state.screen === "playing") world.step(dt);
  },

  render(alpha, frameDt) {
    const dt = Math.min(frameDt, 0.05);
    input.pollGamepad();
    handleGlobalInput();

    if (state.screen === "playing") {
      world.setDir(input.dir);
      if (input.pulseEdge) world.requestPulse();
      // A large audio/sim gap means frames stopped arriving (backgrounded tab, sleep).
      // Pause rather than fast-forward the player into walls they never saw.
      if (music.playing && world.syncClock(music.songTime)) pause();

      if (world.status === "dead" && world.deathTimer >= DEATH_FREEZE) finishRun(false);
      else if (world.status === "cleared") finishRun(true);
    }

    palette.update(dt);
    palette.rebuild(clamp((world.heat - 1) / 7, 0, 1));

    drainEvents(dt);

    if (state.zoneHintTimer > 0) state.zoneHintTimer -= dt;

    renderer.draw(world, palette, dt, {
      showZones: state.screen === "playing" && state.zoneHintTimer > 0,
      zonesAlpha: clamp(state.zoneHintTimer / 1.2, 0, 1),
    });

    if (state.screen === "playing") ui.updateHud(world, dt, bestPctForRun());

    adaptQuality(dt);
    input.endFrame();
  },
});

function handleGlobalInput() {
  if (state.screen === "boot") {
    if (input.confirmEdge || input.anyEdge) {
      // Any input at all counts — this is also the gesture that unlocks audio.
      handleAction({ type: "boot" });
    }
    return;
  }

  if (state.screen === "playing") {
    if (input.pauseEdge) pause();
    return;
  }

  if (state.screen === "paused") {
    if (input.pauseEdge) { resume(); return; }
  }

  if (state.screen === "result") {
    if (input.confirmEdge) { handleAction({ type: "result", action: "retry" }); return; }
    if (input.backEdge) { handleAction({ type: "result", action: "quit" }); return; }
    return;
  }

  // Menu screens: arrow navigation.
  if (input.left) { /* horizontal is unused in menus */ }
  if (input.confirmEdge) { ui.activateMenu(); sfx.uiMove(); return; }
  if (input.backEdge && state.screen !== "title") { goTitle(); sfx.uiMove(); }
}

// Vertical menu navigation needs key edges, which Input does not expose per-key;
// a dedicated listener keeps the hot input path free of menu concerns.
// Capture toggle. Lives outside the screen guards because the whole point is to catch
// a run from before it starts to after it ends.
window.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code !== "KeyR") return;
  if (e.target instanceof HTMLInputElement) return;
  recorder.toggle(RECORD_LIMIT);
  e.preventDefault();
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (["playing", "boot"].includes(state.screen)) return;
  if (e.code === "ArrowDown" || e.code === "KeyS") { ui.moveMenu(1); sfx.uiMove(); e.preventDefault(); }
  else if (e.code === "ArrowUp" || e.code === "KeyW") { ui.moveMenu(-1); sfx.uiMove(); e.preventDefault(); }
});

// Tapping anywhere on the result panel retries. In a game built on failure, the
// distance between dying and playing again is the single biggest retention lever.
document.getElementById("result").addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  handleAction({ type: "result", action: "retry" });
});

/* ---- adaptive quality ---------------------------------------------------- */

function adaptQuality(dt) {
  state.qualityCheck += dt;
  if (state.qualityHold > 0) state.qualityHold -= dt;
  if (state.qualityCheck < 1.1) return;
  state.qualityCheck = 0;

  const worst = loop.recomputeSlow();
  if (state.debug) {
    ui.setPerf(`${loop.stats.fps.toFixed(0)}fps  ${loop.stats.frameMs.toFixed(1)}ms  peak ${worst.toFixed(1)}  q${renderer.quality}  w${world.walls.length}`);
  }
  if (state.qualityHold > 0) return;

  if (worst > 22 && renderer.quality > 0) {
    renderer.setQuality(renderer.quality - 1);
    state.qualityHold = 4;
  } else if (worst < 9 && loop.stats.frameMs < 7 && renderer.quality < 2) {
    renderer.setQuality(renderer.quality + 1);
    state.qualityHold = 8;
  }
}

/* ---- resize -------------------------------------------------------------- */

let resizeRaf = 0;
function onResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    renderer.resize();
  });
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

/* ---- go ------------------------------------------------------------------ */

applySettings();
ui.show("boot");
loop.start();

// Surface fatal errors instead of freezing on a black screen.
window.addEventListener("error", (e) => {
  document.documentElement.dataset.pulsefallError = e.message || "error";
  if (state.debug) ui.toast(`ERR ${e.message}`, 6000);
});

if (state.debug) {
  window.__pulsefall = {
    world, state, music, engine, renderer, palette, loop, store, ui, recorder,
    /** Jump into a track at a fraction of the way through — for eyeballing sections. */
    play(trackId = TRACKS[0].id, at = 0) {
      state.startAt = at;
      state.practice = at > 0.001;
      startRun({ mode: "track", trackId });
    },
    endless() { startRun({ mode: "endless" }); },
  };
  // ?track=void-bloom&at=0.6 boots straight into a section.
  const q = new URLSearchParams(location.search);
  if (q.has("track")) {
    setTimeout(() => {
      boot();
      window.__pulsefall.play(q.get("track"), Number(q.get("at") || 0));
    }, 60);
  }
}
