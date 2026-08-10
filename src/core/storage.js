// Local persistence. Deliberately small: best progress, best score, and enough
// counters to drive the "you are getting better" messaging that carries this genre.

const KEY = "pulsefall.v2";

const EMPTY = {
  tracks: {},        // id -> { bestPct, bestScore, clears, attempts, bestChain, practiceMax }
  endless: { bestScore: 0, bestTime: 0, attempts: 0 },
  daily: {},         // seedId -> { bestScore, bestPct, attempts }
  totalRuns: 0,
  totalDeaths: 0,
  seenIntro: false,
  settings: { music: 0.62, sfx: 0.85, muted: false, shake: true },
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(EMPTY), ...parsed, settings: { ...EMPTY.settings, ...(parsed.settings || {}) } };
  } catch {
    return structuredClone(EMPTY);
  }
}

let cache = read();
let flushTimer = 0;

function schedule() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch { /* private mode, quota — the game must not care */ }
  }, 220);
}

export const store = {
  get data() {
    return cache;
  },

  track(id) {
    if (!cache.tracks[id]) {
      cache.tracks[id] = { bestPct: 0, bestScore: 0, clears: 0, attempts: 0, bestChain: 0, practiceMax: 0 };
    }
    return cache.tracks[id];
  },

  daily(seedId) {
    if (!cache.daily[seedId]) cache.daily[seedId] = { bestScore: 0, bestPct: 0, attempts: 0 };
    return cache.daily[seedId];
  },

  /** Returns which records were broken, so the UI can celebrate the right one. */
  recordRun(mode, id, { pct, score, chain, cleared, time }) {
    cache.totalRuns++;
    if (!cleared) cache.totalDeaths++;
    const broke = { pct: false, score: false, chain: false, firstClear: false };

    if (mode === "endless") {
      const e = cache.endless;
      e.attempts++;
      if (score > e.bestScore) { e.bestScore = score; broke.score = true; }
      if (time > e.bestTime) { e.bestTime = time; }
    } else if (mode === "daily") {
      const d = this.daily(id);
      d.attempts++;
      if (score > d.bestScore) { d.bestScore = score; broke.score = true; }
      if (pct > d.bestPct) { d.bestPct = pct; broke.pct = true; }
    } else {
      const t = this.track(id);
      t.attempts++;
      if (pct > t.bestPct) { t.bestPct = pct; broke.pct = true; }
      if (score > t.bestScore) { t.bestScore = score; broke.score = true; }
      if (chain > t.bestChain) { t.bestChain = chain; broke.chain = true; }
      if (cleared) {
        if (t.clears === 0) broke.firstClear = true;
        t.clears++;
      }
      // Practice checkpoints unlock behind your best, never ahead of it.
      t.practiceMax = Math.max(t.practiceMax, Math.floor(pct * 10) / 10);
    }
    schedule();
    return broke;
  },

  setSetting(key, value) {
    cache.settings[key] = value;
    schedule();
  },

  markIntroSeen() {
    cache.seenIntro = true;
    schedule();
  },

  /** A track is unlocked once the previous one has been reached deep enough. */
  isUnlocked(tracks, index) {
    if (index === 0) return true;
    const prev = tracks[index - 1];
    const t = cache.tracks[prev.id];
    return !!t && (t.clears > 0 || t.bestPct >= 0.6);
  },

  reset() {
    cache = structuredClone(EMPTY);
    schedule();
  },
};
