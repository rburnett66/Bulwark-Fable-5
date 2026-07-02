// Boards. The slice geometry contract (GDD §19.1/§17): one ground lane beside
// one water lane, ending at the player base in a clearing.
//
// Two sources of boards:
//  - SLICE_LAYOUT   — the fixed benchmark board (balance harness + scripted
//                     headless demo run on this so §17 stays comparable).
//  - generateLayout — seeded random boards for interactive games. Fully
//                     deterministic per seed (replays regenerate the same map)
//                     and validated with pathing checks before use.
//
// Pure data + A* — no rendering here.

import { makeRng } from './rng.js';

export const GRID_W = 26;
export const GRID_H = 15;

// Floaters must be able to strike the base from the water lane (GND-Trucks
// range from the workbook). Map validation enforces this reachability.
export const FLOATER_STRIKE_RANGE = 1.25;

export const SLICE_LAYOUT = {
  id: 'slice-fixed',
  desc: 'Benchmark board — river on rows 9–11, outpost on the north bank',
  waterRows: [9, 10, 11],
  base: { c0: 22, r0: 7, c1: 23, r1: 8, cx: 23, cy: 8 },
  spawns: {
    ground: { c: 0, rows: [3, 4, 5] },
    water: { c: 0 },
    air: { min: 1, max: GRID_H - 2 },
  },
  trees: [[6, 1], [7, 2], [11, 1], [16, 2], [20, 1], [4, 7], [9, 13], [14, 13], [19, 13], [24, 3]],
  bands: { high: 3, mid: 6 },
};

// ---------------------------------------------------------------- generation

/**
 * Seeded random board. Draws from its own RNG stream (derived from the game
 * seed) so combat RNG consumption is untouched. Retries until a candidate
 * passes validateLayout; falls back to SLICE_LAYOUT after maxAttempts (never
 * observed in practice — see headless/mapcheck.js).
 */
export function generateLayout(seed, maxAttempts = 12) {
  const rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const layout = rollLayout(rng, seed, attempt);
    const v = validateLayout(layout);
    if (v.ok) return { layout, attempts: attempt, validation: v };
  }
  return { layout: SLICE_LAYOUT, attempts: -1, validation: validateLayout(SLICE_LAYOUT) };
}

function rollLayout(rng, seed, attempt) {
  // river band: position + thickness
  const thk = rng.int(2, 4);
  const top = rng.int(4, GRID_H - 3 - thk);
  const waterRows = [];
  for (let r = top; r < top + thk; r++) waterRows.push(r);
  const above = top, below = GRID_H - (top + thk);

  // outpost bank: needs ≥4 ground rows to live on
  const sides = [];
  if (above >= 4) sides.push('N');
  if (below >= 4) sides.push('S');
  const side = sides[rng.int(0, sides.length - 1)];

  // base 2×2, directly adjacent to the water so floaters can strike it
  const c0 = rng.int(18, GRID_W - 3);
  let r0, r1;
  if (side === 'N') { r1 = top - 1; r0 = r1 - 1; }
  else { r0 = top + thk; r1 = r0 + 1; }
  const base = { c0, r0, c1: c0 + 1, r1, cx: c0 + 1, cy: r0 + 1 };

  // ground spawn corridor: west edge, same bank as the base
  const regTop = side === 'N' ? 0 : top + thk;
  const regBot = side === 'N' ? top - 1 : GRID_H - 1;
  const rs = rng.int(regTop, regBot - 2);
  const groundRows = [rs, rs + 1, rs + 2];

  // tree stands: scattered, never in water / on the base clearing / in the
  // spawn corridor. Bounded draw count keeps the RNG stream finite.
  const trees = [];
  const want = rng.int(7, 13);
  for (let i = 0; i < want * 3 && trees.length < want; i++) {
    const c = rng.int(3, GRID_W - 2);
    const r = rng.int(0, GRID_H - 1);
    if (r >= waterRows[0] && r <= waterRows[waterRows.length - 1]) continue;
    if (c >= base.c0 - 1 && c <= base.c1 + 1 && r >= base.r0 - 1 && r <= base.r1 + 1) continue;
    if (c < 7 && r >= rs - 1 && r <= rs + 3) continue;
    if (trees.some(([tc, tr]) => tc === c && tr === r)) continue;
    trees.push([c, r]);
  }

  // elevation bands (visual): high ground fades toward the river
  const high = rng.int(1, 3);
  const bands = { high, mid: high + rng.int(2, 3) };

  return {
    id: `map-${(seed >>> 0).toString(16)}${attempt > 1 ? '·r' + attempt : ''}`,
    desc: `River on rows ${top}–${top + thk - 1} · outpost on the ${side === 'N' ? 'north' : 'south'} bank · ${trees.length} tree stands`,
    waterRows, base,
    spawns: {
      ground: { c: 0, rows: groundRows },
      water: { c: 0 },
      air: { min: 1, max: GRID_H - 2 },
    },
    trees, bands,
  };
}

/**
 * Quick pathing verification (the playability gate):
 *  - every walker spawn row reaches the base clearing (A*), with a minimum
 *    march length so the defense has room to work;
 *  - the water lane reaches a cell within floater strike range of the base;
 *  - enough buildable ground exists for a real defense.
 */
export function validateLayout(layout) {
  const m = new GameMap(layout);
  let groundLen = Infinity;
  for (const row of layout.spawns.ground.rows) {
    if (!m.walkable(layout.spawns.ground.c, row)) return { ok: false, why: `spawn (0,${row}) not walkable` };
    const p = m.walkerPath(layout.spawns.ground.c, row);
    if (!p) return { ok: false, why: `no ground path from row ${row}` };
    if (p.length < 12) return { ok: false, why: `ground path from row ${row} too short (${p.length})` };
    groundLen = Math.min(groundLen, p.length);
  }
  let waterLen = Infinity;
  for (const row of layout.waterRows) {
    const p = m.waterPath(layout.spawns.water.c, row);
    if (!p) return { ok: false, why: `no water path from row ${row}` };
    waterLen = Math.min(waterLen, p.length);
  }
  let buildable = 0;
  for (let c = 0; c < GRID_W; c++) {
    for (let r = 0; r < GRID_H; r++) if (m.buildable(c, r)) buildable++;
  }
  if (buildable < 45) return { ok: false, why: `only ${buildable} buildable cells` };
  return { ok: true, groundLen, waterLen, buildable };
}

// ------------------------------------------------------------------- GameMap

export function inBounds(c, r) { return c >= 0 && c < GRID_W && r >= 0 && r < GRID_H; }

export class GameMap {
  constructor(layout = SLICE_LAYOUT) {
    this.layout = layout;
    this.blocked = new Set();  // "c,r" cells occupied by structures (walls, towers)
    this.version = 0;          // bumped on any change → units re-path
  }
  key(c, r) { return c + ',' + r; }
  isBlocked(c, r) { return this.blocked.has(this.key(c, r)); }
  setBlocked(c, r, on) {
    const k = this.key(c, r);
    if (on) this.blocked.add(k); else this.blocked.delete(k);
    this.version++;
  }

  isWater(c, r) {
    const w = this.layout.waterRows;
    return r >= w[0] && r <= w[w.length - 1];
  }
  isTree(c, r) { return this.layout.trees.some(([tc, tr]) => tc === c && tr === r); }
  inBase(c, r) {
    const b = this.layout.base;
    return c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1;
  }

  /** distance from a point (tile coords) to the base rectangle edge */
  distToBase(x, y) {
    const b = this.layout.base;
    const dx = Math.max(b.c0 - x, 0, x - (b.c1 + 1));
    const dy = Math.max(b.r0 - y, 0, y - (b.r1 + 1));
    return Math.hypot(dx, dy);
  }
  closestPointOnBase(x, y) {
    const b = this.layout.base;
    return [Math.min(Math.max(x, b.c0), b.c1 + 1), Math.min(Math.max(y, b.r0), b.r1 + 1)];
  }

  walkable(c, r) {
    return inBounds(c, r) && !this.isWater(c, r) && !this.isTree(c, r) && !this.isBlocked(c, r) && !this.inBase(c, r);
  }
  swimmable(c, r) { return inBounds(c, r) && this.isWater(c, r) && !this.isBlocked(c, r); }

  buildable(c, r) {
    return inBounds(c, r) && !this.isWater(c, r) && !this.isTree(c, r) && !this.inBase(c, r) &&
      !this.isBlocked(c, r) && c >= 2 && c <= GRID_W - 2;
  }

  // A* over the grid, 4-directional, deterministic tie-breaks.
  findPath(sc, sr, pass, isGoal, tx, ty) {
    if (isGoal(sc, sr)) return [[sc, sr]];
    const open = [];
    const gScore = new Map();
    const came = new Map();
    const sk = sr * GRID_W + sc;
    gScore.set(sk, 0);
    open.push({ k: sk, c: sc, r: sr, f: Math.abs(tx - sc) + Math.abs(ty - sr) });
    const closed = new Set();
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].k < open[bi].k)) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      if (closed.has(cur.k)) continue;
      closed.add(cur.k);
      if (isGoal(cur.c, cur.r)) {
        const path = [];
        let k = cur.k, c = cur.c, r = cur.r;
        while (k !== undefined) {
          path.push([c, r]);
          const prev = came.get(k);
          if (prev === undefined) break;
          k = prev; c = k % GRID_W; r = (k - c) / GRID_W;
        }
        path.reverse();
        return path;
      }
      for (const [dc, dr] of DIRS) {
        const nc = cur.c + dc, nr = cur.r + dr;
        if (!inBounds(nc, nr)) continue;
        if (!pass(nc, nr) && !isGoal(nc, nr)) continue;
        const nk = nr * GRID_W + nc;
        if (closed.has(nk)) continue;
        const g = gScore.get(cur.k) + 1;
        if (gScore.has(nk) && gScore.get(nk) <= g) continue;
        gScore.set(nk, g);
        came.set(nk, cur.k);
        open.push({ k: nk, c: nc, r: nr, f: g + Math.abs(tx - nc) + Math.abs(ty - nr) });
      }
    }
    return null;
  }

  /** walker path from spawn cell to any ground cell adjacent to the base rect */
  walkerPath(sc, sr) {
    const b = this.layout.base;
    const isGoal = (c, r) =>
      inBounds(c, r) && !this.isWater(c, r) && !this.isBlocked(c, r) && !this.isTree(c, r) && !this.inBase(c, r) &&
      c >= b.c0 - 1 && c <= b.c1 + 1 && r >= b.r0 - 1 && r <= b.r1 + 1;
    return this.findPath(sc, sr, (c, r) => this.walkable(c, r), isGoal, b.cx, b.cy);
  }

  /** floater path: down the lane to a water cell within strike range of the base */
  waterPath(sc, sr) {
    const b = this.layout.base;
    const isGoal = (c, r) =>
      this.isWater(c, r) && this.distToBase(c + 0.5, r + 0.5) <= FLOATER_STRIKE_RANGE + 0.05;
    const goalRow = b.r1 < this.layout.waterRows[0] ? this.layout.waterRows[0] : this.layout.waterRows[this.layout.waterRows.length - 1];
    return this.findPath(sc, sr, (c, r) => this.swimmable(c, r), isGoal, b.cx, goalRow);
  }

  // Would placing a blocker at (c,r) sever the ground lane? (the maze may
  // reroute but never seal)
  placementSealsPath(c, r) {
    this.blocked.add(this.key(c, r));
    let ok = true;
    const sp = this.layout.spawns.ground;
    for (const row of sp.rows) {
      if (!this.walkerPath(sp.c, row)) { ok = false; break; }
    }
    this.blocked.delete(this.key(c, r));
    return !ok;
  }
}
