// Tracks.
//
// A section is one object that describes the music AND the gameplay for the same
// stretch of bars. When the drums drop, `speed` jumps and `sub` halves in the same
// object — so the difficulty spike is not "synced to" the music, it IS the music.
//
// Pattern strings are 16 characters, one per 16th note.
//   drums : '.' rest  'x' hit  'X' accent
//   bass/arp : '.' rest  '-' sustain  '0'-'5' chord-tone index
// `prog` holds scale degrees (0 = tonic) selected per bar.

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/* --- reusable drum figures ------------------------------------------------ */
const K4 = "x...x...x...x...";
const K4b = "x...x...x...x.x.";
const K2 = "x.......x.......";
const KROLL = "x...x...x...xxxx";
const SB = "....x.......x...";
const SBg = "....x.....x.X...";
const H8 = "..x...x...x...x.";
const H16 = ".x.x.x.x.x.x.x.x";
const HACC = "..x...X...x...X.";
const H16a = "xxx.xxx.xxx.xx.x";

/* ========================================================================== */
/* TRACK 1 — FIRST LIGHT                                                      */
/* ========================================================================== */

const FIRST_LIGHT = {
  id: "first-light",
  name: "FIRST LIGHT",
  tag: "얼음이 깨지는 소리",
  bpm: 124,
  root: 57, // A3
  scale: MINOR,
  palette: "ember",
  difficulty: 1,
  sections: [
    {
      name: "RUNWAY",
      bars: 4,
      prog: [0, 0, 5, 5],
      pad: true,
      padGain: 0.085,
      drums: { kick: K2, snare: "", hat: "" },
      bass: "0---------------",
      // gameplay
      sides: 6,
      speed: 0.88,
      sub: 2.5,
      leadBeats: 4,
      rot: 0.14,
      pool: ["barrage"],
      allowPulseGates: false,
      palette: 0,
    },
    {
      name: "IGNITE",
      bars: 6,
      prog: [0, 5, 2, 6],
      pad: true,
      drums: { kick: K4, snare: SB, hat: H8 },
      bass: "0-..0-..0-..0-..",
      sides: 6,
      speed: 1.0,
      sub: 2,
      rot: 0.2,
      rotFlip: 0.5,
      pool: [
        { name: "barrage", w: 3 },
        { name: "alternate", w: 3 },
        { name: "spiral", w: 2 },
      ],
      allowPulseGates: false,
      palette: 0,
    },
    {
      name: "VECTOR",
      bars: 6,
      prog: [0, 5, 2, 6],
      pad: true,
      drums: { kick: K4, snare: SB, hat: HACC },
      bass: "0-..0-..3-..0-..",
      arp: "0.2.4.2.3.2.1.2.",
      arpGain: 0.17,
      sides: 6,
      speed: 1.14,
      sub: 1.5,
      rot: 0.26,
      rotFlip: 0.6,
      pool: [
        { name: "alternate", w: 2 },
        { name: "spiral", w: 3 },
        { name: "spiralTurn", w: 2 },
        { name: "doubleGate", w: 2 },
      ],
      allowPulseGates: false,
      palette: 1,
    },
    {
      name: "GRAZE",
      bars: 4,
      prog: [3, 3, 5, 5],
      pad: true,
      drums: { kick: K2, snare: "", hat: H16 },
      bass: "0-------3-------",
      arp: "0.1.2.3.4.3.2.1.",
      arpGain: 0.2,
      sides: 8,
      speed: 1.05,
      sub: 1.25,
      rot: -0.3,
      pool: [
        { name: "corridor", w: 4 },
        { name: "doubleGate", w: 3 },
      ],
      allowPulseGates: false,
      palette: 2,
      hint: "GRAZE",
    },
    {
      name: "SEAL",
      bars: 6,
      prog: [0, 6, 5, 6],
      pad: true,
      drums: { kick: K4b, snare: SB, hat: H8 },
      bass: "0-0-..0-0-..0-0.",
      arp: "0.2.3.2.4.2.3.1.",
      sides: 6,
      speed: 1.2,
      sub: 1.5,
      rot: 0.3,
      rotFlip: 0.55,
      fx: { riser: true },
      pool: [
        { name: "cage", w: 3 },
        { name: "sealReward", w: 2 },
        { name: "spiral", w: 2 },
        { name: "alternate", w: 2 },
      ],
      palette: 2,
      hint: "PULSE",
    },
    {
      name: "DROP",
      bars: 8,
      prog: [0, 5, 2, 6],
      pad: true,
      padGain: 0.05,
      drums: { kick: K4b, snare: SBg, hat: H16a },
      bass: "0.0.3.0.5.0.3.0.",
      bassGain: 0.52,
      bassCutoff: 1000,
      arp: "0.2.4.5.4.2.3.2.",
      arpGain: 0.22,
      arpOct: 24,
      sides: 6,
      speed: 1.5,
      sub: 1,
      rot: 0.42,
      rotFlip: 0.9,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "spiral", w: 3 },
        { name: "spiralTurn", w: 3 },
        { name: "staircase", w: 2 },
        { name: "syncopate", w: 3 },
        { name: "cage", w: 2 },
        { name: "pincer", w: 2 },
        { name: "inverse", w: 1 },
      ],
      palette: 3,
    },
    {
      name: "PENTA",
      bars: 6,
      prog: [3, 6, 0, 0],
      pad: true,
      drums: { kick: K4, snare: SB, hat: H8 },
      bass: "0-..3-..0-..5-..",
      arp: "4.3.2.1.0.1.2.3.",
      sides: 5, // odd sides: left and right are no longer the same distance
      speed: 1.42,
      sub: 1.25,
      rot: -0.4,
      rotFlip: 0.8,
      pool: [
        { name: "spiral", w: 3 },
        { name: "alternate", w: 2 },
        { name: "swing", w: 2 },
        { name: "cage", w: 2 },
        { name: "doubleGate", w: 1 },
      ],
      palette: 4,
      hint: "PENTA",
    },
    {
      name: "FINALE",
      bars: 4,
      prog: [0, 0, 6, 6],
      pad: true,
      drums: { kick: KROLL, snare: SBg, hat: H16 },
      bass: "0.0.0.0.0.0.0.0.",
      bassGain: 0.55,
      arp: "0.2.4.2.5.4.2.0.",
      arpOct: 24,
      arpGain: 0.24,
      sides: 6,
      speed: 1.72,
      sub: 0.75,
      rot: 0.55,
      rotFlip: 1.1,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "staircase", w: 3 },
        { name: "spiralTurn", w: 3 },
        { name: "syncopate", w: 2 },
        { name: "doubleSeal", w: 1 },
        { name: "cage", w: 2 },
        { name: "swing", w: 2 },
      ],
      palette: 5,
    },
    {
      name: "LANDING",
      bars: 2,
      prog: [0, 0],
      pad: true,
      padGain: 0.11,
      drums: { kick: K2, snare: "", hat: "" },
      bass: "0---------------",
      sides: 6,
      speed: 1.0,
      sub: 4,
      leadBeats: 8,
      rot: 0.1,
      pool: ["barrage"],
      palette: 0,
    },
  ],
};

/* ========================================================================== */
/* TRACK 2 — HOLLOW SUN                                                       */
/* ========================================================================== */

const HOLLOW_SUN = {
  id: "hollow-sun",
  name: "HOLLOW SUN",
  tag: "빛이 없는 정오",
  bpm: 140,
  root: 54, // F#3
  scale: MINOR,
  palette: "violet",
  difficulty: 2,
  sections: [
    {
      name: "APPROACH",
      bars: 4,
      prog: [0, 0, 6, 6],
      pad: true,
      drums: { kick: K2, snare: "", hat: H8 },
      bass: "0-------0-------",
      sides: 6,
      speed: 1.1,
      sub: 2,
      leadBeats: 3,
      rot: 0.24,
      pool: ["barrage", "alternate"],
      allowPulseGates: false,
      palette: 0,
    },
    {
      name: "PRESSURE",
      bars: 6,
      prog: [0, 6, 5, 6],
      pad: true,
      drums: { kick: K4, snare: SB, hat: H8 },
      bass: "0-..0-..6-..0-..",
      arp: "0.2.3.2.0.2.4.2.",
      sides: 6,
      speed: 1.32,
      sub: 1.5,
      rot: 0.34,
      rotFlip: 0.7,
      pool: [
        { name: "spiral", w: 3 },
        { name: "spiralTurn", w: 3 },
        { name: "alternate", w: 2 },
        { name: "cage", w: 2 },
        { name: "pincer", w: 2 },
      ],
      palette: 1,
    },
    {
      name: "SQUARE",
      bars: 5,
      prog: [3, 3, 0, 0],
      pad: true,
      drums: { kick: K4b, snare: SB, hat: H16 },
      bass: "0-0-3-0-0-0-5-0-",
      arp: "3.2.1.0.1.2.3.4.",
      sides: 4, // four huge lanes — long travel, no room to hesitate
      speed: 1.28,
      sub: 1.5,
      rot: -0.42,
      rotFlip: 0.9,
      pool: [
        { name: "alternate", w: 3 },
        { name: "inverse", w: 3 },
        { name: "spiral", w: 2 },
        { name: "cage", w: 2 },
      ],
      palette: 2,
      hint: "QUAD",
    },
    {
      name: "SPIRE",
      bars: 6,
      prog: [0, 5, 6, 0],
      pad: true,
      drums: { kick: K4, snare: SBg, hat: HACC },
      bass: "0.0.5.0.6.0.5.0.",
      arp: "0.2.4.2.5.2.4.2.",
      arpOct: 24,
      sides: 8,
      speed: 1.42,
      sub: 1.25,
      rot: 0.46,
      rotFlip: 0.8,
      fx: { riser: true },
      pool: [
        { name: "corridor", w: 3 },
        { name: "staircase", w: 3 },
        { name: "doubleGate", w: 2 },
        { name: "sealReward", w: 2 },
        { name: "syncopate", w: 2 },
      ],
      palette: 3,
    },
    {
      name: "COLLAPSE",
      bars: 8,
      prog: [0, 6, 5, 6],
      pad: true,
      padGain: 0.05,
      drums: { kick: K4b, snare: SBg, hat: H16a },
      bass: "0.0.0.6.0.0.5.0.",
      bassGain: 0.54,
      bassCutoff: 1100,
      arp: "0.2.4.5.7.5.4.2.",
      arpOct: 24,
      arpGain: 0.23,
      sides: 6,
      speed: 1.72,
      sub: 0.75,
      rot: 0.55,
      rotFlip: 1.2,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "spiralTurn", w: 3 },
        { name: "staircase", w: 3 },
        { name: "syncopate", w: 3 },
        { name: "cage", w: 3 },
        { name: "swing", w: 2 },
        { name: "doubleSeal", w: 1 },
        { name: "pincer", w: 2 },
      ],
      palette: 4,
    },
    {
      name: "EYE",
      bars: 4,
      prog: [3, 3, 5, 5],
      pad: true,
      padGain: 0.12,
      drums: { kick: K2, snare: "", hat: "" },
      bass: "0---------------",
      arp: "0...2...4...2...",
      arpGain: 0.16,
      sides: 6,
      speed: 1.0,
      sub: 2.5,
      leadBeats: 2,
      rot: -0.15,
      pool: [{ name: "doubleGate", w: 3 }, { name: "corridor", w: 2 }],
      palette: 5,
      hint: "BREATHE",
    },
    {
      name: "TERMINAL",
      bars: 8,
      prog: [0, 0, 6, 5],
      pad: true,
      drums: { kick: KROLL, snare: SBg, hat: H16 },
      bass: "0.0.0.0.0.0.0.0.",
      bassGain: 0.56,
      arp: "0.2.4.7.4.2.5.2.",
      arpOct: 24,
      arpGain: 0.25,
      sides: 7, // odd again, and fast
      speed: 1.9,
      sub: 0.75,
      rot: 0.68,
      rotFlip: 1.4,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "staircase", w: 3 },
        { name: "spiralTurn", w: 3 },
        { name: "syncopate", w: 3 },
        { name: "cage", w: 3 },
        { name: "doubleSeal", w: 2 },
        { name: "inverse", w: 2 },
        { name: "swing", w: 2 },
      ],
      palette: 6,
    },
    {
      name: "SET",
      bars: 2,
      prog: [0, 0],
      pad: true,
      padGain: 0.12,
      drums: { kick: K2, snare: "", hat: "" },
      bass: "0---------------",
      sides: 6,
      speed: 1.0,
      sub: 4,
      leadBeats: 8,
      rot: 0.08,
      pool: ["barrage"],
      palette: 0,
    },
  ],
};

/* ========================================================================== */
/* TRACK 3 — VOID BLOOM                                                       */
/* ========================================================================== */

const VOID_BLOOM = {
  id: "void-bloom",
  name: "VOID BLOOM",
  tag: "아무도 끝을 보지 못했다",
  bpm: 152,
  root: 50, // D3
  scale: DORIAN,
  palette: "void",
  difficulty: 3,
  sections: [
    {
      name: "ZERO",
      bars: 4,
      prog: [0, 0, 0, 0],
      pad: true,
      drums: { kick: K4, snare: "", hat: H16 },
      bass: "0-..0-..0-..0-..",
      sides: 6,
      speed: 1.3,
      sub: 1.5,
      leadBeats: 2,
      rot: 0.3,
      rotFlip: 0.6,
      pool: ["alternate", "spiral", "barrage"],
      allowPulseGates: false,
      palette: 0,
    },
    {
      name: "THORN",
      bars: 6,
      prog: [0, 5, 0, 6],
      pad: true,
      drums: { kick: K4b, snare: SB, hat: H16 },
      bass: "0.0.5.0.0.0.6.0.",
      arp: "0.2.4.2.5.4.2.0.",
      sides: 6,
      speed: 1.58,
      sub: 1,
      rot: 0.48,
      rotFlip: 1.0,
      pool: [
        { name: "spiralTurn", w: 3 },
        { name: "staircase", w: 3 },
        { name: "cage", w: 3 },
        { name: "syncopate", w: 2 },
        { name: "pincer", w: 2 },
      ],
      palette: 1,
    },
    {
      name: "TRIAD",
      bars: 5,
      prog: [3, 3, 6, 6],
      pad: true,
      drums: { kick: K4, snare: SBg, hat: HACC },
      bass: "0-0-0-0-3-3-3-3-",
      arp: "4.2.0.2.4.5.4.2.",
      arpOct: 24,
      sides: 3, // three lanes. Everything is a commitment.
      speed: 1.35,
      sub: 1.75,
      rot: -0.5,
      rotFlip: 1.0,
      pool: [
        { name: "alternate", w: 3 },
        { name: "inverse", w: 2 },
        { name: "cage", w: 3 },
        { name: "sealReward", w: 2 },
      ],
      palette: 2,
      hint: "TRIAD",
    },
    {
      name: "BLOOM",
      bars: 8,
      prog: [0, 6, 5, 3],
      pad: true,
      padGain: 0.05,
      drums: { kick: K4b, snare: SBg, hat: H16a },
      bass: "0.0.6.0.5.0.3.0.",
      bassGain: 0.55,
      bassCutoff: 1200,
      arp: "0.2.4.5.7.5.4.2.",
      arpOct: 24,
      arpGain: 0.24,
      sides: 9,
      speed: 1.72,
      sub: 0.75,
      rot: 0.6,
      rotFlip: 1.3,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "corridor", w: 3 },
        { name: "staircase", w: 4 },
        { name: "spiral", w: 3 },
        { name: "doubleGate", w: 2 },
        { name: "syncopate", w: 3 },
        { name: "cage", w: 2 },
      ],
      palette: 3,
    },
    {
      name: "WITHER",
      bars: 6,
      prog: [0, 0, 5, 5],
      pad: true,
      drums: { kick: K2, snare: SB, hat: H8 },
      bass: "0-------5-------",
      arp: "0...4...2...5...",
      sides: 6,
      speed: 1.45,
      sub: 1.25,
      rot: -0.55,
      rotFlip: 1.1,
      fx: { riser: true },
      pool: [
        { name: "doubleSeal", w: 2 },
        { name: "sealReward", w: 3 },
        { name: "corridor", w: 3 },
        { name: "inverse", w: 2 },
      ],
      palette: 4,
    },
    {
      name: "SINGULAR",
      bars: 10,
      prog: [0, 6, 5, 6],
      pad: true,
      drums: { kick: KROLL, snare: SBg, hat: H16a },
      bass: "0.0.0.0.6.0.5.0.",
      bassGain: 0.58,
      arp: "0.2.4.7.5.4.2.5.",
      arpOct: 24,
      arpGain: 0.26,
      sides: 6,
      speed: 2.05,
      sub: 0.625,
      rot: 0.78,
      rotFlip: 1.6,
      spin: 1,
      fx: { impact: true },
      pool: [
        { name: "staircase", w: 4 },
        { name: "spiralTurn", w: 4 },
        { name: "syncopate", w: 3 },
        { name: "cage", w: 3 },
        { name: "doubleSeal", w: 2 },
        { name: "swing", w: 3 },
        { name: "inverse", w: 2 },
        { name: "pincer", w: 2 },
      ],
      palette: 5,
    },
    {
      name: "BLACK",
      bars: 2,
      prog: [0, 0],
      pad: true,
      padGain: 0.13,
      drums: { kick: K2, snare: "", hat: "" },
      bass: "0---------------",
      sides: 6,
      speed: 1.0,
      sub: 4,
      leadBeats: 8,
      rot: 0.05,
      pool: ["barrage"],
      palette: 6,
    },
  ],
};

export const TRACKS = [FIRST_LIGHT, HOLLOW_SUN, VOID_BLOOM];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

/* ========================================================================== */
/* ENDLESS                                                                    */
/* ========================================================================== */

/**
 * Endless mode: the same section grammar, generated on and on with an escalating
 * curve. Everything before rank 4 is deliberately survivable so a new player still
 * gets the "I got further this time" beat that keeps them pressing retry.
 */
const ENDLESS_POOLS = [
  ["barrage", "alternate", "spiral"],
  ["alternate", "spiral", "spiralTurn", "doubleGate"],
  ["spiral", "spiralTurn", "staircase", "corridor", "cage"],
  ["spiralTurn", "staircase", "syncopate", "cage", "pincer", "swing"],
  ["staircase", "syncopate", "cage", "doubleSeal", "inverse", "swing", "spiralTurn"],
];

const ENDLESS_SIDES = [6, 6, 6, 5, 6, 8, 6, 4, 6, 7, 6, 9];

export function makeEndlessTrack(rng, { bars = 220, bpm = 138 } = {}) {
  const sections = [];
  let bar = 0;
  let rank = 0;
  let i = 0;
  while (bar < bars) {
    const len = i === 0 ? 4 : rng.int(4, 6);
    const t = Math.min(bar / 90, 1);
    rank = Math.min(4, Math.floor(bar / 18));
    const drop = i > 0 && i % 4 === 3;

    sections.push({
      name: i === 0 ? "ORIGIN" : `RANK ${String(rank + 1).padStart(2, "0")}`,
      bars: len,
      prog: [0, 5, 2, 6],
      pad: true,
      padGain: drop ? 0.05 : 0.08,
      drums: {
        kick: rank === 0 ? K2 : drop ? KROLL : rank >= 2 ? K4b : K4,
        snare: rank === 0 ? "" : rank >= 3 ? SBg : SB,
        hat: rank === 0 ? "" : rank >= 3 ? H16a : rank >= 1 ? H8 : "",
      },
      bass: rank === 0 ? "0-------0-------" : drop ? "0.0.0.0.0.0.0.0." : "0-..0-..3-..0-..",
      arp: rank >= 2 ? "0.2.4.2.3.2.1.2." : null,
      arpOct: drop ? 24 : 12,
      sides: i === 0 ? 6 : ENDLESS_SIDES[i % ENDLESS_SIDES.length],
      speed: 0.95 + t * 0.95 + (drop ? 0.16 : 0),
      sub: Math.max(0.625, 2.4 - t * 1.6 - (drop ? 0.2 : 0)),
      leadBeats: i === 0 ? 4 : 0,
      rot: (rng.chance(0.5) ? 1 : -1) * (0.16 + t * 0.5),
      rotFlip: 0.4 + t * 0.9,
      spin: drop ? 1 : 0,
      fx: drop ? { impact: true } : i > 0 && i % 4 === 2 ? { riser: true } : null,
      pool: ENDLESS_POOLS[rank],
      allowPulseGates: rank >= 2,
      palette: i % 7,
    });
    bar += len;
    i++;
  }

  return {
    id: "endless",
    name: "ENDLESS",
    tag: "끝은 없다",
    bpm,
    root: 55,
    scale: MINOR,
    palette: "endless",
    difficulty: 0,
    endless: true,
    sections,
  };
}
