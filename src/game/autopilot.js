// Autopilot. One brain, two jobs:
//
//   1. `npm test` plays every chart headlessly at 240 Hz to prove it is survivable.
//   2. The title screen plays itself, so a new player watches the game demonstrate
//      grazing and beat-locked pulses before reading a single word of instruction.
//
// It is deliberately unclever — one ring of lookahead, steer to the nearest gap at
// full speed, pulse when there is nowhere to be. A chart this cannot clear is a chart
// that will feel unfair to a human.
//
// CRITICAL: every predicate here must match World's exactly. An earlier version used
// a slightly looser "has this wall passed?" test and spent an afternoon blaming
// perfectly good charts for its own clipping.

import { TAU } from "../core/mathx.js";
import {
  PLAYER_R, BASE_WALL_SPEED, PLAYER_SPEED, BEAT_WINDOW, PLAYER_HALF_W, HIT_FORGIVE,
  PULSE_DURATION, PULSE_COST,
} from "./constants.js";

const SAMPLES = 180;

export function createAutopilot() {
  return { blocked: new Uint8Array(SAMPLES) };
}

/** Drive `world` for one tick. Returns a small debug record. */
export function autopilotStep(world, brain) {
  const blocked = brain.blocked;

  // World's own "is this wall still dangerous?" test, verbatim.
  const past = (w) => w.dist + w.thick - HIT_FORGIVE < PLAYER_R;

  let lead = Infinity;
  for (const w of world.walls) {
    if (past(w)) continue;
    if (w.dist < lead) lead = w.dist;
  }
  if (!Number.isFinite(lead)) {
    world.setDir(0);
    return { idle: true };
  }

  const band = lead + 0.075;
  blocked.fill(0);
  let group = 0;
  let groupSpeed = 1;
  let sealed = false;
  for (const w of world.walls) {
    if (past(w) || w.dist > band) continue;
    if (w.kind === "bonus") continue;
    group++;
    if (w.span >= w.sides) sealed = true;
    if (w.speed > groupSpeed) groupSpeed = w.speed;
    // Aim at the ARRIVAL geometry, not the current one. A drifting wall is somewhere
    // else right now, and chasing where it is instead of where it is going is exactly
    // the mistake a new player makes. Once it arrives the two are the same value.
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * TAU;
      let rel = (a - w.baseA0) % TAU;
      if (rel < 0) rel += TAU;
      if (rel < w.baseSpan) blocked[i] = 1;
    }
  }

  // The cursor is a wedge, not a point: dilate by its half-width plus one sample of
  // slack, so "free" means free for the whole cursor.
  const grow = Math.ceil(PLAYER_HALF_W / (TAU / SAMPLES)) + 1;
  if (group > 0) {
    const src = Uint8Array.from(blocked);
    for (let i = 0; i < SAMPLES; i++) {
      if (!src[i]) continue;
      for (let k = -grow; k <= grow; k++) blocked[(i + k + SAMPLES) % SAMPLES] = 1;
    }
  }

  const eta = Math.max((lead - PLAYER_R) / (BASE_WALL_SPEED * groupSpeed), 0);

  const pa = world.angle;
  let bestIdx = -1;
  let bestCost = Infinity;
  let bestTravel = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    if (blocked[i]) continue;
    // Prefer roomy gaps slightly, so it does not wedge itself into a slot it will
    // have to leave immediately.
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
    if (cost < bestCost) {
      bestCost = cost;
      bestIdx = i;
      bestTravel = travel;
    }
  }

  const reachable = bestIdx >= 0 && bestTravel < PLAYER_SPEED * eta * 0.92;

  // Fire as late as is still safe. Walls arrive on beats, so "as late as is safe"
  // and "on the beat" are the same instant — which is the whole design.
  if (group > 0 && (bestIdx < 0 || !reachable) && world.pulseTimer <= 0) {
    const dwell = 0.105 / (BASE_WALL_SPEED * groupSpeed);
    const latest = Math.max(0.04, PULSE_DURATION - dwell - 0.04);
    const onBeat = world.beatError() <= BEAT_WINDOW;
    if (eta <= Math.min(latest, BEAT_WINDOW) && (onBeat || world.charge >= PULSE_COST)) {
      world.requestPulse();
    }
  }

  if (bestIdx < 0) {
    world.setDir(0);
    return { lead, group, eta, sealed, noGap: true };
  }

  const target = (bestIdx / SAMPLES) * TAU;
  let d = (target - pa) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  world.setDir(Math.abs(d) < 0.02 ? 0 : d > 0 ? 1 : -1);
  return { lead, group, eta, sealed, target, travel: bestTravel, reachable };
}
