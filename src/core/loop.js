// Fixed-timestep simulation, decoupled render.
//
// This is the single most important file in the project. The old build ran physics
// on raw frame delta, so a hitch changed the game speed and walls tunnelled through
// the player. In a game where a run ends in 4 frames, that reads as "the game
// cheated", which kills the retry impulse. Simulation now advances in exact
// 1/240 s steps regardless of what the display is doing.

export const TICK_HZ = 240;
export const TICK_DT = 1 / TICK_HZ;

/** Never simulate more than this much wall-clock in one frame (tab-switch guard). */
const MAX_CATCHUP = 0.25;

export function createLoop({ step, render }) {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  // Rolling frame-time stats, used by the adaptive quality controller.
  const samples = new Float32Array(60);
  let sampleIdx = 0;
  let sampleCount = 0;

  const stats = {
    fps: 60,
    frameMs: 16.7,
    /** 95th-percentile-ish frame cost; drives quality downgrades. */
    slowMs: 16.7,
    ticks: 0,
  };

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running) return;

    const t = now * 0.001;
    if (last === 0) last = t;
    let elapsed = t - last;
    last = t;

    if (elapsed > MAX_CATCHUP) elapsed = TICK_DT; // came back from a background tab
    acc += elapsed;

    const startMs = performance.now();

    let ticks = 0;
    while (acc >= TICK_DT) {
      step(TICK_DT);
      acc -= TICK_DT;
      ticks++;
      // Hard ceiling so a slow device degrades into slow-motion rather than
      // a death spiral where each frame owes more simulation than the last.
      if (ticks >= 24) {
        acc = 0;
        break;
      }
    }
    stats.ticks = ticks;

    // Fractional tick left over — renderers use it to interpolate.
    render(acc / TICK_DT, elapsed);

    const cost = performance.now() - startMs;
    samples[sampleIdx] = cost;
    sampleIdx = (sampleIdx + 1) % samples.length;
    if (sampleCount < samples.length) sampleCount++;

    stats.frameMs += (cost - stats.frameMs) * 0.05;
    stats.fps += (1 / Math.max(elapsed, 0.0001) - stats.fps) * 0.05;
  }

  /** Worst frame in the recent window — a single 40 ms spike should be visible. */
  function recomputeSlow() {
    let worst = 0;
    for (let i = 0; i < sampleCount; i++) if (samples[i] > worst) worst = samples[i];
    stats.slowMs = worst;
    return worst;
  }

  return {
    stats,
    recomputeSlow,
    start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
    },
    dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
