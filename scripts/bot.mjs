// Headless runner around the shared autopilot. Used by the smoke test and the auditor.
// The decision logic itself lives in src/game/autopilot.js so the thing that validates
// the charts is literally the same code that demos them on the title screen.

import { World } from "../src/game/world.js";
import { createAutopilot, autopilotStep } from "../src/game/autopilot.js";

const TICK = 1 / 240;

export function runBot(chart, { maxSeconds = 500, trace = false } = {}) {
  const world = new World();
  world.reset(chart, { startTime: 0 });
  world.start();

  const brain = createAutopilot();
  const history = [];
  let kill = null;

  const origDie = world._die.bind(world);
  world._die = (wall) => {
    kill = {
      time: world.songTime,
      section: world.section?.name,
      angle: world.angle,
      charge: world.charge,
      wall: {
        kind: wall.kind, side: wall.side, span: wall.span, sides: wall.sides,
        dist: wall.dist, thick: wall.thick, speed: wall.speed,
        a0: wall.a0, a1: wall.a1,
      },
      others: world.walls.filter((w) => w !== wall && w.dist < 0.9)
        .map((w) => ({ k: w.kind, d: +w.dist.toFixed(3), a0: +w.a0.toFixed(2), a1: +w.a1.toFixed(2) })),
    };
    origDie(wall);
  };

  let steps = 0;
  const limit = Math.ceil(Math.min(chart.duration + 2, maxSeconds) / TICK);

  while (world.status === "running" && steps++ < limit) {
    const info = autopilotStep(world, brain);
    world.step(TICK);
    world.events.length = 0;
    if (trace && steps % 10 === 0) {
      history.push({ t: world.songTime, a: world.angle, c: world.charge, ...info });
      if (history.length > 90) history.shift();
    }
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
    kill,
    history,
  };
}
