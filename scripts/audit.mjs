// Chart auditor. `node scripts/audit.mjs [trackIndex|all|endless]`
//
// Runs the autoplay bot and, when it dies, prints exactly what killed it and what the
// last two seconds looked like. This is the tool for answering "is that chart unfair,
// or is the bot just short-sighted?" without guessing.

import { TRACKS, makeEndlessTrack } from "../src/game/tracks.js";
import { compileChart } from "../src/game/chart.js";
import { makeRng, hashString, dailySeedId } from "../src/core/rng.js";
import { runBot } from "./bot.mjs";

const arg = process.argv[2] ?? "all";

function report(name, chart) {
  const r = runBot(chart, { trace: true });
  const f = chart.fairness || {};
  console.log(
    `\n\x1b[1m${name}\x1b[0m  ${chart.walls.length} walls · ${chart.duration.toFixed(1)}s · ` +
    `${f.rings} rings · ${f.rotations} rotated · ${f.opened} seals opened · ` +
    `worst slack ${Number.isFinite(f.worstSlack) ? f.worstSlack.toFixed(2) : "—"} rad`
  );
  console.log(
    `  bot: ${(r.progress * 100).toFixed(1)}%  graze ${r.graze}  pulse ${r.pulses} ` +
    `(${r.perfect} on-beat)  heat ×${r.heat.toFixed(1)}  score ${Math.round(r.score)}`
  );

  if (!r.kill) {
    console.log("  \x1b[32mcleared\x1b[0m");
    return true;
  }

  const k = r.kill;
  console.log(`  \x1b[31mdied @${k.time.toFixed(2)}s in ${k.section}\x1b[0m  charge ${k.charge.toFixed(2)}`);
  console.log(
    `    wall: ${k.wall.kind} side ${k.wall.side} span ${k.wall.span}/${k.wall.sides} ` +
    `arc ${k.wall.a0.toFixed(2)}–${k.wall.a1.toFixed(2)}  dist ${k.wall.dist.toFixed(3)} ` +
    `thick ${k.wall.thick.toFixed(3)} speed ${k.wall.speed.toFixed(2)}`
  );
  console.log(`    cursor at ${k.angle.toFixed(3)}`);
  if (k.others.length) console.log(`    also on screen: ${JSON.stringify(k.others)}`);
  console.log("    last 1.2s:");
  for (const h of r.history.slice(-30)) {
    console.log(
      `      t=${h.t.toFixed(2)} a=${h.a.toFixed(2)} chg=${h.c.toFixed(2)} ` +
      `lead=${h.lead?.toFixed(2) ?? "—"} grp=${h.group ?? "—"} eta=${h.eta?.toFixed(3) ?? "—"} ` +
      `${h.sealed ? "SEALED " : ""}${h.noGap ? "NOGAP " : ""}` +
      `tgt=${h.target?.toFixed(2) ?? "—"} reach=${h.reachable ?? "—"}`
    );
  }
  return false;
}

let allOk = true;

if (arg === "endless") {
  for (let i = 0; i < 8; i++) {
    const seed = 1000 + i * 7919;
    const t = makeEndlessTrack(makeRng(seed), { bars: 120 });
    allOk = report(`ENDLESS seed ${seed}`, compileChart(t, seed)) && allOk;
  }
} else if (arg === "daily") {
  const sid = dailySeedId();
  const t = makeEndlessTrack(makeRng(hashString(sid)), { bars: 96, bpm: 132 });
  allOk = report(`DAILY ${sid}`, compileChart(t, hashString(sid)));
} else if (arg === "all") {
  for (const t of TRACKS) allOk = report(t.name, compileChart(t, hashString(t.id))) && allOk;
} else {
  const t = TRACKS[Number(arg)] ?? TRACKS[0];
  allOk = report(t.name, compileChart(t, hashString(t.id)));
}

console.log("");
process.exit(allOk ? 0 : 1);
