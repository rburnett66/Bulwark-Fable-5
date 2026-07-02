#!/usr/bin/env node
// Random map generation audit.
//
//   node headless/mapcheck.js [--seeds 500]
//
// For every seed: generate a board, confirm the pathing validation passed
// (walker route from each spawn row, floater route into strike range, minimum
// march length, buildable ground), confirm generation is DETERMINISTIC
// (regenerate → byte-identical layout), and run a short no-build battle twice
// to prove the sim stays seed-stable on generated maps.

import { generateLayout, validateLayout } from '../src/sim/map.js';
import { Sim, TICK_RATE } from '../src/sim/sim.js';

const args = process.argv.slice(2);
const i = args.indexOf('--seeds');
const N = i >= 0 ? Number(args[i + 1]) : 500;

let fallbacks = 0, retried = 0, fail = 0;
const attemptsHist = {};
let minGround = Infinity, maxGround = 0, minBuild = Infinity;

for (let seed = 1; seed <= N; seed++) {
  const a = generateLayout(seed);
  const b = generateLayout(seed);
  if (JSON.stringify(a.layout) !== JSON.stringify(b.layout)) {
    console.error(`✗ seed ${seed}: generation not deterministic`);
    fail++;
    continue;
  }
  const v = validateLayout(a.layout);
  if (!v.ok) {
    console.error(`✗ seed ${seed}: shipped an invalid map — ${v.why}`);
    fail++;
    continue;
  }
  attemptsHist[a.attempts] = (attemptsHist[a.attempts] || 0) + 1;
  if (a.attempts === -1) fallbacks++;
  else if (a.attempts > 1) retried++;
  minGround = Math.min(minGround, v.groundLen);
  maxGround = Math.max(maxGround, v.groundLen);
  minBuild = Math.min(minBuild, v.buildable);
}

// sim determinism spot-check on generated maps (no builds; 20 sim-seconds)
for (const seed of [3, 77, 12345]) {
  const run = (s) => {
    const sim = new Sim({ seed: s });
    sim.issueCommand({ type: 'startWave' });
    for (let t = 0; t < 20 * TICK_RATE; t++) { sim.step(); sim.events.length = 0; }
    return sim.hash();
  };
  const h1 = run(seed), h2 = run(seed);
  if (h1 !== h2) { console.error(`✗ seed ${seed}: sim hash diverged on generated map`); fail++; }
  else console.log(`seed ${seed}: generated-map battle hash ${h1} (reproduced ✓)`);
}

console.log(`\n${N} seeds: ${N - fail} valid maps, ${retried} needed a re-roll, ${fallbacks} fell back to the fixed board`);
console.log(`attempts histogram: ${JSON.stringify(attemptsHist)}`);
console.log(`shortest/longest walker march: ${minGround}/${maxGround} tiles · sparsest buildable ground: ${minBuild} cells`);
console.log(fail === 0 ? '✓ MAPCHECK PASSED' : `✗ ${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
