// Replay = the determinism requirement made visible (visual spec §9).
// A battle log is (seed + tick-stamped commands + final hash). Re-driving the
// same Sim from the log must reproduce the identical battle; the hash check
// at the end is the acceptance test.

import { Sim } from './sim.js';

export function finalizeLog(sim, meta = {}) {
  return {
    ...sim.log,
    outcome: sim.over,
    ticks: sim.tick,
    finalHash: sim.hash(),
    wavesCleared: sim.over === 'win' ? sim.wave : Math.max(0, sim.wave - 1),
    ...meta,
  };
}

/** Run a log headless to completion. Returns {outcome, ticks, hash, verified}. */
export function verifyLog(log, maxTicks = 1e6) {
  const sim = new Sim({ seed: log.seed });
  sim.feedCommands(log.commands);
  while (!sim.over && sim.tick < maxTicks) sim.step();
  return {
    outcome: sim.over,
    ticks: sim.tick,
    hash: sim.hash(),
    verified: sim.hash() === log.finalHash && sim.over === log.outcome,
  };
}

// ---- localStorage persistence (browser only) --------------------------------
const KEY = 'bulwark.replays.v1';
const MAX_REPLAYS = 12;

export function loadReplays() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}

export function saveReplay(log) {
  const all = loadReplays();
  all.unshift(log);
  while (all.length > MAX_REPLAYS) all.pop();
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full: drop */ }
}

export function deleteReplay(index) {
  const all = loadReplays();
  all.splice(index, 1);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
