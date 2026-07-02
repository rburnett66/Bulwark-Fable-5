// Deterministic PRNG (mulberry32) + FNV-1a state hashing.
// The sim must never touch Math.random / Date.now — all randomness flows
// through one seeded stream so a (seed, commands) pair replays identically.

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, maxInclusive) { return min + Math.floor(next() * (maxInclusive - min + 1)); },
  };
}

export function hashInit() { return 0x811c9dc5; }

export function hashNum(h, n) {
  // quantize floats so identical sims hash identically across runs
  const q = Math.round(n * 1024) | 0;
  h ^= q & 0xff;         h = Math.imul(h, 0x01000193);
  h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

export function hashStr(h, s) {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
