// Pattern library.
//
// Walls sit on discrete sides of the arena polygon, never on arbitrary arcs. That is
// the thing the old build got wrong: a gold arc on a smooth ring looks different every
// time but plays identically, so the game reads as random noise and never becomes
// learnable. Sided walls give the player a vocabulary — "spiral", "pincer", "cage" —
// and once they have a vocabulary they can improve, and improvement is the retention.
//
// Every pattern returns { events, beats }:
//   events : [{ beat, side, span, thick, speed, kind }]  beat is relative to pattern start
//   beats  : how long the pattern occupies the timeline
//
// kind:
//   'wall'  normal
//   'solid' full ring, no gap — must be pulsed through (rendered in the danger accent)
//   'graze' thin wall with a wide gap, placed to bait an edge hug
//   'bonus' safe strip that refunds charge if you pass inside it

// Default wall thickness in field units. Roughly 6% of the visible radius: thick
// enough to read as a solid band at speed, thin enough that three rings on screen
// still leave the gaps as the dominant shape.
const T = 0.078;

const mod = (a, n) => ((a % n) + n) % n;

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the walls of one ring. `open` lists the sides to leave empty; every other
 * side is filled. Contiguous filled sides are merged into a single wall so the
 * graze test only ever sees a real outer boundary, never an internal seam.
 */
function ring(beat, sides, open, { thick = T, speed = 1, kind = "wall" } = {}) {
  const blocked = new Array(sides).fill(true);
  for (const s of open) blocked[mod(s, sides)] = false;

  const openIdx = blocked.indexOf(false);
  if (openIdx === -1) {
    return [{ beat, side: 0, span: sides, thick, speed, kind: kind === "wall" ? "solid" : kind }];
  }

  const out = [];
  let i = 0;
  while (i < sides) {
    const idx = mod(openIdx + i, sides);
    if (!blocked[idx]) {
      i++;
      continue;
    }
    let span = 0;
    while (span < sides && blocked[mod(openIdx + i + span, sides)]) span++;
    out.push({ beat, side: idx, span, thick, speed, kind });
    i += span;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* patterns                                                                   */
/* -------------------------------------------------------------------------- */

/** One ring, one opening. The alphabet's first letter. */
export function pBarrage({ rng, sides, sub }) {
  const s = rng.int(0, sides - 1);
  return { events: ring(0, sides, [s]), beats: sub * 2 };
}

/** Opening alternates between two neighbouring sides. Pure left-right metronome. */
export function pAlternate({ rng, sides, sub, count = 4 }) {
  const a = rng.int(0, sides - 1);
  const b = mod(a + (rng.chance(0.5) ? 1 : -1), sides);
  const ev = [];
  for (let i = 0; i < count; i++) ev.push(...ring(i * sub, sides, [i % 2 ? b : a]));
  return { events: ev, beats: sub * (count + 1) };
}

/** Opening walks one side per ring — hold a direction and ride it. */
export function pSpiral({ rng, sides, sub, count = 6, dir = 0 }) {
  const d = dir || (rng.chance(0.5) ? 1 : -1);
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s]));
    s = mod(s + d, sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** Spiral that reverses halfway. Punishes players who just hold the key down. */
export function pSpiralTurn({ rng, sides, sub, count = 8 }) {
  let d = rng.chance(0.5) ? 1 : -1;
  let s = rng.int(0, sides - 1);
  const ev = [];
  const turn = Math.floor(count / 2);
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s]));
    if (i === turn) d *= -1;
    s = mod(s + d, sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** Opening jumps to the far side every ring. Maximum travel, maximum panic. */
export function pInverse({ rng, sides, sub, count = 4 }) {
  const half = Math.floor(sides / 2);
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub * 1.5, sides, [s]));
    s = mod(s + half, sides);
  }
  return { events: ev, beats: sub * 1.5 * (count + 1) };
}

/** Two openings on opposite sides — a free breath, and a graze buffet. */
export function pDoubleGate({ rng, sides, sub, count = 3 }) {
  const half = Math.floor(sides / 2);
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s, mod(s + half, sides)], { kind: "graze", thick: T * 0.8 }));
    s = mod(s + 1, sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** A long corridor: two fixed walls with a lane between them. Farm grazes here. */
export function pCorridor({ rng, sides, sub, count = 6 }) {
  const s = rng.int(0, sides - 1);
  const open = [s];
  if (sides >= 7) open.push(mod(s + 1, sides));
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub * 0.5, sides, open, { kind: "graze", thick: T * 0.55 }));
  }
  return { events: ev, beats: sub * 0.5 * count + sub };
}

/** Half the arena walled off, closing from alternating hands. */
export function pPincer({ rng, sides, sub, count = 4 }) {
  const ev = [];
  let s = rng.int(0, sides - 1);
  const arc = Math.max(2, sides - 2);
  for (let i = 0; i < count; i++) {
    const open = [];
    for (let k = 0; k < sides - arc; k++) open.push(mod(s + k, sides));
    ev.push(...ring(i * sub, sides, open));
    s = mod(s + (i % 2 ? 1 : -1) * Math.max(1, Math.floor(sides / 3)), sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** Gap steps quickly — a run of stairs you sprint up. */
export function pStaircase({ rng, sides, sub, count = 8 }) {
  const d = rng.chance(0.5) ? 1 : -1;
  let s = rng.int(0, sides - 1);
  const ev = [];
  const step = sub * 0.5;
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * step, sides, [s], { thick: T * 0.7 }));
    s = mod(s + d, sides);
  }
  return { events: ev, beats: step * count + sub };
}

/* ---- pulse-gated patterns ------------------------------------------------ */
// These exist so the second verb has teeth. They cannot be solved by movement.

/**
 * A gapped ring immediately plugged by a bar over that gap — the community calls it
 * "box with a cap". Enter the gap, then leave it before the cap lands. Not a seal:
 * the rest of the ring is open, so this is solved by moving, not by pulsing.
 */
export function pCage({ rng, sides, sub }) {
  const s = rng.int(0, sides - 1);
  const ev = [...ring(0, sides, [s])];
  ev.push({ beat: sub * 0.62, side: s, span: 1, thick: T * 0.85, speed: 1, kind: "wall" });
  return { events: ev, beats: sub * 2.2 };
}

/** A sealed ring. Nowhere to stand. The only answer is a pulse. */
export function pSeal({ sub }) {
  return { events: [{ beat: 0, side: 0, span: -1, thick: T * 0.8, speed: 1, kind: "solid" }], beats: sub * 2 };
}

/** Two sealed rings back to back — costs two charges, or two on-beat pulses. */
export function pDoubleSeal({ sub }) {
  return {
    events: [
      { beat: 0, side: 0, span: -1, thick: T * 0.7, speed: 1, kind: "solid" },
      { beat: sub * 1.5, side: 0, span: -1, thick: T * 0.7, speed: 1, kind: "solid" },
    ],
    beats: sub * 3.5,
  };
}

/** Sealed ring with a bonus strip right behind it: pulse through, get paid. */
export function pSealReward({ rng, sides, sub }) {
  const s = rng.int(0, sides - 1);
  return {
    events: [
      { beat: 0, side: 0, span: -1, thick: T * 0.7, speed: 1, kind: "solid" },
      { beat: sub * 1.1, side: s, span: 1, thick: T * 0.5, speed: 1, kind: "bonus" },
    ],
    beats: sub * 2.6,
  };
}

/* ---- rhythm-shaped patterns ---------------------------------------------- */

/** Rings land on a syncopated figure so the pattern is audible before it is visible. */
export function pSyncopate({ rng, sides, sub }) {
  const offs = [0, 0.75, 1.5, 2.0, 2.75];
  let s = rng.int(0, sides - 1);
  const d = rng.chance(0.5) ? 1 : -1;
  const ev = [];
  for (const o of offs) {
    ev.push(...ring(o * sub, sides, [s], { thick: T * 0.8 }));
    s = mod(s + d, sides);
  }
  return { events: ev, beats: sub * 4 };
}

/** Alternating fast/slow walls — visually uneven, rhythmically exact. */
export function pSwing({ rng, sides, sub, count = 6 }) {
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    const fast = i % 2 === 1;
    // Keep the spread modest: too much and a later ring overtakes an earlier one,
    // which reads as a bug rather than as swing.
    ev.push(...ring(i * sub * 0.75, sides, [s], { speed: fast ? 1.18 : 0.9, thick: T * 0.8 }));
    s = mod(s + (i % 2 ? 2 : -1), sides);
  }
  return { events: ev, beats: sub * 0.75 * count + sub };
}

/* ---- swirl patterns ------------------------------------------------------ */
// These are the ones the front-on hexagon could never have. The gap is not where it
// looks like it is — you have to read where it is *going*, then be there first.

/** Every ring spins the same way. The whole field reads as one turning gear. */
export function pSwirl({ rng, sides, sub, swirl = 1, count = 5 }) {
  const dir = rng.chance(0.5) ? 1 : -1;
  const amount = swirl * rng.range(0.8, 1.25) * dir;
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s], { drift: amount, thick: T * 0.9 }));
    s = mod(s + dir, sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** Alternating spin. Consecutive rings counter-rotate — a shearing, braided read. */
export function pShear({ rng, sides, sub, swirl = 1, count = 6 }) {
  const amount = swirl * rng.range(0.9, 1.4);
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub * 0.75, sides, [s], {
      drift: driftFor(rng, i, "pendulum", amount),
      thick: T * 0.85,
    }));
    s = mod(s + (i % 2 ? 2 : -1), sides);
  }
  return { events: ev, beats: sub * 0.75 * count + sub };
}

/** Spin accelerates through the phrase. Musically it lands like a fill. */
export function pWindUp({ rng, sides, sub, swirl = 1, count = 6 }) {
  const dir = rng.chance(0.5) ? 1 : -1;
  const amount = swirl * dir;
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub * 0.75, sides, [s], {
      drift: driftFor(rng, i, "ramp", amount),
      thick: T * 0.85,
    }));
    s = mod(s + dir, sides);
  }
  return { events: ev, beats: sub * 0.75 * count + sub };
}

/* ---- iris patterns ------------------------------------------------------- */

/** The gap closes as it comes. Wide and inviting at distance, exact on arrival. */
export function pIrisClose({ rng, sides, sub, count = 4 }) {
  let s = rng.int(0, sides - 1);
  const d = rng.chance(0.5) ? 1 : -1;
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s], { iris: -0.55, thick: T * 0.85 }));
    s = mod(s + d, sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** The gap opens as it comes — bait to hold the edge and farm the graze. */
export function pIrisOpen({ rng, sides, sub, count = 4 }) {
  let s = rng.int(0, sides - 1);
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub, sides, [s], { iris: 0.6, thick: T * 0.85, kind: "graze" }));
    s = mod(s + (i % 2 ? 1 : -1), sides);
  }
  return { events: ev, beats: sub * (count + 1) };
}

/** A drifting corridor: two walls sweeping together, with you inside them. */
export function pDriftLane({ rng, sides, sub, swirl = 1, count = 6 }) {
  const dir = rng.chance(0.5) ? 1 : -1;
  const amount = swirl * 0.8 * dir;
  const s = rng.int(0, sides - 1);
  const open = [s];
  if (sides >= 7) open.push(mod(s + 1, sides));
  const ev = [];
  for (let i = 0; i < count; i++) {
    ev.push(...ring(i * sub * 0.5, sides, open, { drift: amount, kind: "graze", thick: T * 0.6 }));
  }
  return { events: ev, beats: sub * 0.5 * count + sub };
}

/* -------------------------------------------------------------------------- */

export const PATTERNS = {
  swirl: pSwirl,
  shear: pShear,
  windUp: pWindUp,
  irisClose: pIrisClose,
  irisOpen: pIrisOpen,
  driftLane: pDriftLane,
  barrage: pBarrage,
  alternate: pAlternate,
  spiral: pSpiral,
  spiralTurn: pSpiralTurn,
  inverse: pInverse,
  doubleGate: pDoubleGate,
  corridor: pCorridor,
  pincer: pPincer,
  staircase: pStaircase,
  cage: pCage,
  seal: pSeal,
  doubleSeal: pDoubleSeal,
  sealReward: pSealReward,
  syncopate: pSyncopate,
  swing: pSwing,
};

/** Patterns that cannot be cleared by movement alone — these emit full sealed rings. */
export const PULSE_GATED = new Set(["seal", "doubleSeal", "sealReward"]);
