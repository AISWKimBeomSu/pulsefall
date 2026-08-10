// Chart compiler: track + seed -> a fixed, sorted list of wall spawns.
//
// Two properties matter here.
//
// 1. DETERMINISM. The same track always compiles to the same chart, so a player who
//    dies at 68% can learn the thing that killed them. Endless survival can never
//    offer that, and a run you cannot study is a run you cannot get better at.
//
// 2. FAIRNESS. After compiling, we walk the chart and check every ring against the
//    player's actual top angular speed. Anything unreachable gets rotated on-grid
//    until it is reachable. An unfair death is the one thing that makes a player
//    close the app, and "it was random" is not an excuse the player accepts.

import { PATTERNS, PULSE_GATED } from "./patterns.js";
import { makeRng } from "../core/rng.js";
import { TAU, clamp } from "../core/mathx.js";
import {
  PLAYER_R, SPAWN_R, PLAYER_SPEED, BASE_WALL_SPEED, PLAYER_HALF_W, START_ANGLE,
  PULSE_MAX_CHARGE, GRAZE_CHARGE, PULSE_COOLDOWN,
} from "./constants.js";

const EPS = 1e-4;

export function compileChart(track, seed) {
  const rng = makeRng(seed);
  const spb = 60 / track.bpm;
  const walls = [];
  const sections = [];

  let beat = 0;
  let sectionIndex = 0;

  for (const s of track.sections) {
    const startBeat = beat;
    const lenBeats = s.bars * 4;
    const endBeat = startBeat + lenBeats;

    sections.push({
      index: sectionIndex++,
      name: s.name,
      startBeat,
      endBeat,
      sides: s.sides,
      speed: s.speed,
      rot: s.rot ?? 0,
      rotFlip: s.rotFlip ?? 0,
      spin: s.spin ?? 0,
      palette: s.palette ?? 0,
      raw: s,
    });

    let cursor = startBeat + (s.leadBeats ?? 0);
    const pool = s.pool && s.pool.length ? s.pool : ["barrage"];
    let guard = 0;

    while (cursor < endBeat - 0.25 && guard++ < 400) {
      const name = pickPattern(rng, pool, s);
      const fn = PATTERNS[name];
      if (!fn) break;

      const built = fn({
        rng,
        sides: s.sides,
        sub: s.sub ?? 1,
      });

      for (const ev of built.events) {
        const span = ev.span < 0 ? s.sides : ev.span;
        const sealed = span >= s.sides;
        // A sealed ring is answered by an on-beat pulse, and "on the beat" is judged
        // against the quarter note. Patterns are free to sit on any subdivision, so a
        // seal that landed on a syncopated 16th would be unanswerable through no fault
        // of the player. Seals snap to the downbeat; everything else keeps its groove.
        let beatAt = cursor + ev.beat;
        if (sealed) beatAt = Math.round(beatAt);

        walls.push({
          beat: beatAt,
          time: beatAt * spb,
          side: ev.side,
          span,
          sides: s.sides,
          thick: ev.thick,
          speed: ev.speed * s.speed,
          kind: sealed ? "solid" : ev.kind,
          pattern: name,
        });
      }
      cursor += built.beats;
    }

    beat = Math.max(cursor, endBeat);
  }

  walls.sort((a, b) => a.beat - b.beat || a.side - b.side);

  const totalBeats = beat;
  const chart = {
    trackId: track.id,
    seed,
    bpm: track.bpm,
    spb,
    walls,
    sections,
    totalBeats,
    duration: totalBeats * spb,
  };

  enforceFairness(chart);
  finalise(chart);
  return chart;
}

/**
 * Walls ARRIVE on the beat, they do not spawn on it. That distinction is the entire
 * feel of the game: the player hits the gap exactly when the kick lands, so the chart
 * is something you can hear before you can see it.
 */
function finalise(chart) {
  const travel = SPAWN_R - PLAYER_R;
  // The fairness pass can shrink a wall to nothing when it opens a sealed ring.
  chart.walls = chart.walls.filter((w) => w.span > 0);
  for (const w of chart.walls) {
    w.travel = travel / (BASE_WALL_SPEED * w.speed);
    w.spawnTime = w.time - w.travel;
  }
  chart.walls.sort((a, b) => a.spawnTime - b.spawnTime);
  const first = chart.walls.length ? chart.walls[0].spawnTime : 0;
  chart.leadIn = Math.max(0, -first);
}

function pickPattern(rng, pool, section) {
  // Pools are authored as either ["a","b"] or [{ name, w }].
  const items = pool.map((p) => (typeof p === "string" ? { name: p, w: 1 } : p));
  const allowGated = section.allowPulseGates !== false;
  const usable = allowGated ? items : items.filter((i) => !PULSE_GATED.has(i.name));
  return rng.weighted(usable.length ? usable : items).name;
}

/* -------------------------------------------------------------------------- */
/* fairness pass                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Group walls that arrive together on the same grid, and work out the window during
 * which the player is actually inside that ring.
 *
 * `w.time` is the moment the wall's INNER face reaches the cursor's orbit — but
 * contact begins when the OUTER face gets there, one thickness earlier. Budgeting a
 * player's travel from inner-face to inner-face silently hands them an extra
 * thick/speed seconds they do not have; at a 0.105 wall and speed 1.4 that is 75 ms,
 * more than half a hexagon side. That error is exactly what an unfair chart is made of.
 */
function buildRings(walls) {
  const rings = [];
  let cur = null;
  for (const w of walls) {
    if (!cur || Math.abs(w.beat - cur.beat) > 1e-3 || w.sides !== cur.sides) {
      cur = { beat: w.beat, sides: w.sides, walls: [], speed: w.speed, enter: Infinity, exit: -Infinity };
      rings.push(cur);
    }
    cur.walls.push(w);
    cur.speed = Math.min(cur.speed, w.speed);
    const dwell = w.thick / (BASE_WALL_SPEED * w.speed);
    cur.enter = Math.min(cur.enter, w.time - dwell);
    cur.exit = Math.max(cur.exit, w.time);
  }
  // Patterns that mix wall speeds (swing) let a later ring overtake an earlier one.
  // The player meets them in arrival order, so the solver has to walk them that way.
  rings.sort((a, b) => a.enter - b.enter);
  return rings;
}

/** Open angular intervals of a ring, as [start, end] pairs (may wrap). */
function openIntervals(ring) {
  const n = ring.sides;
  const step = TAU / n;
  const blocked = new Array(n).fill(false);
  for (const w of ring.walls) {
    for (let k = 0; k < w.span; k++) blocked[(w.side + k) % n] = true;
  }
  const free = [];
  for (let i = 0; i < n; i++) if (!blocked[i]) free.push(i);
  if (!free.length) return [];

  // Merge contiguous free sides into intervals, starting from a blocked boundary.
  const startIdx = blocked.indexOf(true);
  if (startIdx === -1) return [[0, TAU]];
  const out = [];
  let i = 0;
  while (i < n) {
    const idx = (startIdx + i) % n;
    if (blocked[idx]) {
      i++;
      continue;
    }
    let span = 0;
    while (span < n && !blocked[(startIdx + i + span) % n]) span++;
    out.push([idx * step, idx * step + span * step]);
    i += span;
  }
  return out;
}

function intervalCenter([a, b]) {
  return (a + b) * 0.5;
}

/**
 * Angular travel needed to get the cursor safely inside `[a,b]`, or Infinity if the
 * gap is narrower than the cursor. The interval is shrunk by a half-width on each
 * side because the cursor is a wedge, not a point.
 */
function travelInto(from, [a, b]) {
  const inset = Math.min(PLAYER_HALF_W * 1.25, (b - a) * 0.4);
  const aa = a + inset;
  const width = b - inset - aa;
  if (width <= 0) return Infinity;
  let rel = (from - aa) % TAU;
  if (rel < 0) rel += TAU;
  if (rel <= width) return 0; // already inside
  return Math.min(TAU - rel, rel - width);
}

/**
 * Rotate a ring's walls by whole sides until at least one gap is reachable from
 * `fromAngle` within `budget` radians. Returns the angle the player ends up at.
 */
function enforceFairness(chart) {
  const rings = buildRings(chart.walls);

  let prevAngle = wrapTauLocal(START_ANGLE);
  let prevExit = -Infinity;
  let charges = 1.0; // conservative model of the pulse meter
  let worstSlack = Infinity;
  let rotations = 0;
  let opened = 0;
  // Sealed rings are answered with a pulse. An on-beat pulse is never refused, so the
  // only thing that can make two seals unanswerable is the cooldown between them —
  // this tracks when the modelled player last spent one.
  let lastPulse = -Infinity;

  for (const ring of rings) {
    const arrive = ring.enter;
    // Free-movement time is from the moment the previous ring lets go to the moment
    // this one first touches — not inner-face to inner-face.
    const dt = Math.max(arrive - prevExit, 0);
    // 78% of theoretical top speed. Humans do not hold a perfect line, and reaction
    // time eats the first ~80 ms of any budget.
    const budget = Number.isFinite(dt) ? PLAYER_SPEED * dt * 0.78 : Math.PI;

    let gaps = openIntervals(ring);

    if (!gaps.length) {
      // A sealed ring arrives on a beat, and an on-beat pulse is never refused, so
      // charge can never be the reason a seal kills. The only real constraint is the
      // pulse cooldown: two seals closer together than that cannot both be answered.
      if (arrive - lastPulse >= PULSE_COOLDOWN + 0.06) {
        lastPulse = arrive;
        prevExit = ring.exit;
        continue; // pulsed straight through; the cursor has not moved
      }
      openOneSide(ring);
      opened++;
      gaps = openIntervals(ring);
    }

    if (!gaps.length) {
      prevExit = ring.exit;
      continue;
    }

    let pick = cheapestGap(gaps, prevAngle);

    if (pick.cost > budget + EPS) {
      // Try every on-grid rotation of this ring and take the cheapest one to reach.
      // Rotating keeps the pattern's shape — a spiral stays a spiral — while moving
      // its entrance to somewhere the player can actually be.
      const n = ring.sides;
      const step = TAU / n;
      let bestK = 0;
      for (let k = 1; k < n; k++) {
        const shifted = gaps.map(([a, b]) => [a + k * step, b + k * step]);
        const r = cheapestGap(shifted, prevAngle);
        if (r.cost < pick.cost) {
          pick = r;
          bestK = k;
        }
        if (pick.cost <= budget * 0.55) break;
      }
      if (bestK !== 0) {
        for (const w of ring.walls) w.side = (w.side + bestK) % n;
        rotations++;
      }
    }

    if (pick.best) {
      // Land near the gap edge — that is where grazes live, and where a player
      // moving as fast as the chart demands actually ends up.
      prevAngle = pick.cost > 0 ? nearestEdge(prevAngle, pick.best) : prevAngle;
      // Assume the player only converts half their graze opportunities.
      charges = Math.min(PULSE_MAX_CHARGE, charges + GRAZE_CHARGE * 0.5);
      worstSlack = Math.min(worstSlack, budget - pick.cost);
    }
    prevExit = ring.exit;
  }

  chart.fairness = { rings: rings.length, rotations, opened, worstSlack };
  return chart;
}

function cheapestGap(gaps, from) {
  let best = null;
  let cost = Infinity;
  for (const g of gaps) {
    const c = travelInto(from, g);
    if (c < cost) {
      cost = c;
      best = g;
    }
  }
  return { best, cost };
}

/** Downgrade a sealed ring the player cannot possibly have a charge for. */
function openOneSide(ring) {
  const victim = ring.walls.reduce((a, b) => (a.span >= b.span ? a : b));
  if (victim.span > 1) {
    victim.span -= 1;
    victim.side = (victim.side + 1) % ring.sides;
  } else {
    victim.span = 0;
  }
  ring.walls = ring.walls.filter((w) => w.span > 0);
  for (const w of ring.walls) if (w.kind === "solid") w.kind = "wall";
}

function wrapTauLocal(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

function nearestEdge(from, [a, b]) {
  // Never park the reference player on the exact boundary: the cursor is a wedge,
  // not a point, so the safe band starts one half-width inside the gap.
  const inset = clamp((b - a) * 0.25, PLAYER_HALF_W * 1.6, 0.16);
  const c1 = a + inset;
  const c2 = b - inset;
  return Math.abs(shortestSigned(from, c1)) < Math.abs(shortestSigned(from, c2)) ? c1 : c2;
}

function shortestSigned(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/* -------------------------------------------------------------------------- */

/** Percent progress through a chart at a given song time. */
export function chartProgress(chart, songTime) {
  return clamp(songTime / chart.duration, 0, 1);
}
