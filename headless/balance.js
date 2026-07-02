#!/usr/bin/env node
// GDD §17 — automated balance sim & unit pricing (the deterministic core).
//
// Rule: a unit's price = its average effective DPS across 100 automated
// battles on a fixed harness (single ground lane beside a single water lane,
// standard documented defense set at fixed positions — the same board the
// vertical slice plays on).
//
// Effective DPS = damage actually delivered to the base + structures divided
// by total attacker alive-time. Units the defense deletes early price low;
// units that punch through price high. Prices are the sim talking, not a
// designer guessing.
//
//   node headless/balance.js                 # slice units, 100 runs each
//   node headless/balance.js --all           # full 72-unit roster
//   node headless/balance.js --runs 40       # fewer runs (faster)
//   node headless/balance.js --faction GND   # one faction
//
// Grading hooks: prints per-unit mean/σ, first-vs-second-half convergence,
// and a cross-seed-block stability check.

import { Sim } from '../src/sim/sim.js';
import { TICK_RATE } from '../src/sim/sim.js';
import { UNITS_ALL, unitById } from '../src/sim/data.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const RUNS = Number(opt('--runs', 100));
const RUN_SECONDS = 75;   // long enough for the slowest walkers to reach the clearing
const SPAWN_EVERY = 3.0;       // stream one unit every 3s
const GOLD_PER_DPS = 300 / 45; // anchor: GND-Troops (300g, 45 raw DPS) ≈ its workbook price

// Standard documented defense set (fixed positions — keep these stable so
// price tables from independent builds converge):
const DEFENSE_SET = [
  ['cannon', 14, 6], ['cannon', 18, 8], ['flak', 16, 6],
  ['wall', 12, 5], ['wall', 12, 6], ['wall', 12, 7],
];

function harnessRun(unitId, seed) {
  const sim = new Sim({ seed, sandbox: true });
  for (const [k, c, r] of DEFENSE_SET) sim.harnessPlace(k, c, r);
  const def = unitById(unitId);
  const spawnTicks = Math.round(SPAWN_EVERY * TICK_RATE);
  const total = Math.round(RUN_SECONDS * TICK_RATE);
  for (let t = 0; t < total; t++) {
    if (t % spawnTicks === 0) sim.harnessSpawn(unitId);
    sim.step();
    sim.events.length = 0; // discard; headless
    if (sim.baseHP <= 0) break;
  }
  const aliveSec = sim.attackerAliveTicks / TICK_RATE;
  return aliveSec > 0 ? sim.attackerDamage / aliveSec : 0;
}

function stats(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd };
}

let units = UNITS_ALL;
if (!flag('--all')) {
  const fac = opt('--faction', null);
  units = fac ? UNITS_ALL.filter(u => u.id.startsWith(fac)) :
    UNITS_ALL.filter(u => ['GND-Troops', 'GND-Trucks', 'GND-Tanks', 'GND-Artillery',
      'GND-HeavyTanks', 'GND-Copters', 'GND-Planes', 'GND-Missiles'].includes(u.id));
}

console.log(`BULWARK balance harness — ${units.length} unit(s) × ${RUNS} runs × ${RUN_SECONDS}s`);
console.log(`defense set: ${DEFENSE_SET.map(d => d.join('@')).join(' ')}\n`);
console.log('UnitID'.padEnd(16), 'domain'.padEnd(8), 'effDPS'.padEnd(9), 'σ'.padEnd(8),
  'conv%'.padEnd(7), 'blockΔ%'.padEnd(8), 'PRICE'.padEnd(7), 'sheet');

const table = [];
for (const u of units) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(harnessRun(u.id, 1000 + i * 7));
  const { mean, sd } = stats(runs);
  // convergence: does the first half agree with the full average?
  const half = stats(runs.slice(0, Math.floor(RUNS / 2))).mean;
  const conv = mean > 0.01 ? Math.abs(half - mean) / mean * 100 : 0;
  // seed stability: two disjoint seed blocks within tolerance?
  const blockA = stats(runs.filter((_, i) => i % 2 === 0)).mean;
  const blockB = stats(runs.filter((_, i) => i % 2 === 1)).mean;
  const blockDelta = mean > 0.01 ? Math.abs(blockA - blockB) / mean * 100 : 0;
  const price = Math.round(mean * GOLD_PER_DPS);
  table.push({ id: u.id, price });
  console.log(u.id.padEnd(16), u.domain.padEnd(8),
    mean.toFixed(2).padEnd(9), sd.toFixed(2).padEnd(8),
    conv.toFixed(1).padEnd(7), blockDelta.toFixed(1).padEnd(8),
    String(price).padEnd(7), Math.round(u.cost[0]));
}

console.log('\nPRICE TABLE (gold = avg effective DPS × ' + GOLD_PER_DPS.toFixed(2) + '):');
console.log(JSON.stringify(Object.fromEntries(table.map(t => [t.id, t.price]))));
console.log('\nread: conv% ≈ 0 → prices stabilized over the run count;');
console.log('      blockΔ% small → stable across seed blocks (GDD §17 grade (c),(d)).');
