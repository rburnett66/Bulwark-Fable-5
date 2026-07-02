#!/usr/bin/env node
// Headless proof (GDD §19.1: "combat core callable headless").
// Runs a scripted battle twice with the same seed and asserts identical hashes,
// then runs a different seed to show divergence.
//
//   node headless/run.js [--seed 42]

import { Sim } from '../src/sim/sim.js';
import { TICK_RATE } from '../src/sim/sim.js';

const args = process.argv.slice(2);
const seed = Number(args[args.indexOf('--seed') + 1]) || 42;

// A scripted player: the same build the tutorial suggests.
const SCRIPT = [
  { type: 'place', kind: 'cannon', c: 19, r: 6 },
  { type: 'place', kind: 'cannon', c: 20, r: 8 },
  { type: 'place', kind: 'cannon', c: 12, r: 4 },
  { type: 'place', kind: 'flak', c: 18, r: 6 },
  { type: 'place', kind: 'wall', c: 13, r: 4 },
  { type: 'place', kind: 'wall', c: 13, r: 5 },
  { type: 'startWave' },
];
const LATER = [
  { at: 30, type: 'place', kind: 'cannon', c: 21, r: 5 },
  { at: 55, type: 'place', kind: 'cannon', c: 19, r: 8 },
  { at: 80, type: 'place', kind: 'flak', c: 20, r: 6 },
  { at: 110, type: 'upgradeFirst', kind: 'cannon' },
  { at: 140, type: 'upgradeFirst', kind: 'flak' },
  { at: 170, type: 'upgradeFirst', kind: 'cannon' },
  { at: 200, type: 'place', kind: 'cannon', c: 18, r: 8 },
];

function runOnce(s) {
  const sim = new Sim({ seed: s });
  for (const c of SCRIPT) sim.issueCommand(c);
  const later = [...LATER];
  const maxTicks = 60 * 60 * TICK_RATE;
  while (!sim.over && sim.tick < maxTicks) {
    while (later.length && sim.tick >= later[0].at * TICK_RATE) {
      const a = later.shift();
      if (a.type === 'upgradeFirst') {
        const t = sim.structures.find(x => x.kind === a.kind && x.state === 'ready' && x.tier === 0);
        if (t) sim.issueCommand({ type: 'upgrade', id: t.id });
      } else {
        sim.issueCommand(a);
      }
    }
    sim.step();
    for (const ev of sim.drainEvents()) {
      if (['waveStart', 'waveClear', 'win', 'lose', 'destroyed'].includes(ev.t)) {
        const sec = (sim.tick / TICK_RATE).toFixed(1);
        console.log(`  [${sec}s] ${ev.t}${ev.wave ? ' ' + ev.wave : ''}${ev.name ? ' — ' + ev.name : ''}`);
      }
    }
  }
  return sim;
}

console.log(`BULWARK headless battle — seed ${seed}`);
const a = runOnce(seed);
console.log(`  outcome=${a.over} ticks=${a.tick} baseHP=${Math.round(a.baseHP)} gold=${Math.round(a.gold)} hash=${a.hash()}`);
console.log('re-running identical seed…');
const b = runOnce(seed);
console.log(`  outcome=${b.over} ticks=${b.tick} hash=${b.hash()}`);
const match = a.hash() === b.hash() && a.tick === b.tick;
console.log(match ? '✓ DETERMINISTIC: identical replay under fixed seed' : '✗ NON-DETERMINISTIC: hashes differ!');
const c = runOnce(seed + 1);
console.log(`different seed ${seed + 1}: hash=${c.hash()} (${c.hash() !== a.hash() ? 'diverges as expected' : 'WARNING: collision?'})`);
process.exit(match ? 0 : 1);
