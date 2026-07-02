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

// Water is a cell mask (ints r*GRID_W+c) so rivers can meander organically.
export const cellKey = (c, r) => r * GRID_W + c;

function bandWater(rows) {
  const w = [];
  for (const r of rows) for (let c = 0; c < GRID_W; c++) w.push(cellKey(c, r));
  return w;
}

export const SLICE_LAYOUT = {
  id: 'slice-fixed',
  desc: 'Benchmark board — straight river on rows 9–11, outpost on the north bank',
  water: bandWater([9, 10, 11]),
  base: { c0: 22, r0: 7, c1: 23, r1: 8, cx: 23, cy: 8 },
  spawns: {
    ground: { c: 0, rows: [3, 4, 5] },
    water: { c: 0, rows: [9, 10, 11] },
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
    if (!layout) continue; // no shoreline clearing / spawn bank — re-roll
    const v = validateLayout(layout);
    if (v.ok) return { layout, attempts: attempt, validation: v };
  }
  return { layout: SLICE_LAYOUT, attempts: -1, validation: validateLayout(SLICE_LAYOUT) };
}

function rollLayout(rng, seed, attempt) {
  // ---- organic river: a meandering west→east walk with varying width -------
  const waterSet = new Set();
  const entry = rng.int(4, GRID_H - 5);
  let y = entry;
  let target = rng.int(3, GRID_H - 4);
  let half = rng.int(0, 1);            // brush half-width → river 2–3 tiles wide
  const centers = [];
  for (let c = 0; c < GRID_W; c++) {
    if (c % 5 === 4) target = rng.int(3, GRID_H - 4);        // new meander goal
    const drift = Math.sign(target - y) * Math.min(1, Math.abs(target - y)) * (0.45 + rng.next() * 0.5);
    y = Math.max(2.2, Math.min(GRID_H - 3.2, y + drift));
    const cy = Math.round(y);
    // keep consecutive columns overlapping so the channel stays navigable
    const prev = centers.length ? centers[centers.length - 1] : cy;
    const cc = Math.max(prev - 1, Math.min(prev + 1, cy));
    centers.push(cc);
    if (rng.next() < 0.22) half = half === 0 ? 1 : 0;         // width breathes
    for (let r = cc - half; r <= cc + 1; r++) {               // 2–3 rows wide
      if (r >= 1 && r < GRID_H - 1) waterSet.add(cellKey(c, r));
    }
  }
  // optional pond budding off the river bank
  let pond = false;
  if (rng.next() < 0.4) {
    pond = true;
    const pc = rng.int(4, GRID_W - 6);
    const above = rng.next() < 0.5;
    const pr = centers[pc] + (above ? -(2) : 2);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (Math.abs(dc) + Math.abs(dr) > (rng.next() < 0.5 ? 1 : 2)) continue;
        const c = pc + dc, r = pr + dr;
        if (c >= 1 && c < GRID_W - 1 && r >= 1 && r < GRID_H - 1) waterSet.add(cellKey(c, r));
      }
    }
  }
  const isW = (c, r) => waterSet.has(cellKey(c, r));

  // ---- outpost: 2×2 clearing in the east, hugging the shoreline ------------
  const candidates = [];
  for (let c0 = 16; c0 <= GRID_W - 3; c0++) {
    for (let r0 = 1; r0 <= GRID_H - 3; r0++) {
      let ground = true;
      for (let c = c0; c <= c0 + 1 && ground; c++) {
        for (let r = r0; r <= r0 + 1 && ground; r++) if (isW(c, r)) ground = false;
      }
      if (!ground) continue;
      // needs an orthogonally adjacent water cell so floaters can strike it
      let shore = false;
      for (let c = c0; c <= c0 + 1 && !shore; c++) {
        if (isW(c, r0 - 1) || isW(c, r0 + 2)) shore = true;
      }
      for (let r = r0; r <= r0 + 1 && !shore; r++) {
        if (isW(c0 - 1, r) || isW(c0 + 2, r)) shore = true;
      }
      if (shore) candidates.push([c0, r0]);
    }
  }
  if (!candidates.length) return null;                        // re-roll
  const [bc0, br0] = candidates[rng.int(0, candidates.length - 1)];
  const base = { c0: bc0, r0: br0, c1: bc0 + 1, r1: br0 + 1, cx: bc0 + 1, cy: br0 + 1 };

  // ---- ground spawns: west-edge cells on the base's bank (flood fill) ------
  const reach = groundComponentFromBase(waterSet, base);
  const spawnRowsAll = [];
  for (let r = 0; r < GRID_H; r++) {
    if (!isW(0, r) && reach.has(cellKey(0, r))) spawnRowsAll.push(r);
  }
  if (spawnRowsAll.length < 3) return null;                   // re-roll
  const si = rng.int(0, spawnRowsAll.length - 3);
  const groundRows = spawnRowsAll.slice(si, si + 3);

  // ---- water spawns: wherever the river meets the west edge ----------------
  const waterRowsWest = [];
  for (let r = 0; r < GRID_H; r++) if (isW(0, r)) waterRowsWest.push(r);
  if (!waterRowsWest.length) return null;                     // re-roll

  // ---- tree stands: never in water / the base clearing / spawn corridor ----
  const trees = [];
  const want = rng.int(7, 13);
  for (let i = 0; i < want * 3 && trees.length < want; i++) {
    const c = rng.int(3, GRID_W - 2);
    const r = rng.int(0, GRID_H - 1);
    if (isW(c, r)) continue;
    if (c >= base.c0 - 1 && c <= base.c1 + 1 && r >= base.r0 - 1 && r <= base.r1 + 1) continue;
    if (c < 7 && r >= groundRows[0] - 1 && r <= groundRows[groundRows.length - 1] + 1) continue;
    if (trees.some(([tc, tr]) => tc === c && tr === r)) continue;
    trees.push([c, r]);
  }

  // elevation bands (visual): high ground fades toward the river
  const high = rng.int(1, 3);
  const bands = { high, mid: high + rng.int(2, 3) };

  const bank = base.cy < centers[Math.min(base.c0, GRID_W - 1)] ? 'north' : 'south';
  return {
    id: `map-${(seed >>> 0).toString(16)}${attempt > 1 ? '·r' + attempt : ''}`,
    desc: `Winding river (enters row ${waterRowsWest[0]})${pond ? ' with a pond' : ''} · outpost on the ${bank} bank · ${trees.length} tree stands`,
    water: [...waterSet].sort((a, b) => a - b),
    base,
    spawns: {
      ground: { c: 0, rows: groundRows },
      water: { c: 0, rows: waterRowsWest },
      air: { min: 1, max: GRID_H - 2 },
    },
    trees, bands,
  };
}

/** flood-fill the ground component containing the base's walkable ring */
function groundComponentFromBase(waterSet, base) {
  const seen = new Set();
  const stack = [];
  for (let c = base.c0 - 1; c <= base.c1 + 1; c++) {
    for (let r = base.r0 - 1; r <= base.r1 + 1; r++) {
      const inBase = c >= base.c0 && c <= base.c1 && r >= base.r0 && r <= base.r1;
      if (inBounds(c, r) && !inBase && !waterSet.has(cellKey(c, r))) stack.push([c, r]);
    }
  }
  while (stack.length) {
    const [c, r] = stack.pop();
    const k = cellKey(c, r);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!inBounds(nc, nr) || waterSet.has(cellKey(nc, nr)) || seen.has(cellKey(nc, nr))) continue;
      const inBase = nc >= base.c0 && nc <= base.c1 && nr >= base.r0 && nr <= base.r1;
      if (inBase) continue;
      stack.push([nc, nr]);
    }
  }
  return seen;
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
  for (const row of layout.spawns.water.rows) {
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
    this.waterSet = new Set(layout.water);
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

  isWater(c, r) { return this.waterSet.has(cellKey(c, r)); }
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

  /** floater path: down the river to a water cell within strike range of the base */
  waterPath(sc, sr) {
    const b = this.layout.base;
    const isGoal = (c, r) =>
      this.isWater(c, r) && this.distToBase(c + 0.5, r + 0.5) <= FLOATER_STRIKE_RANGE + 0.05;
    return this.findPath(sc, sr, (c, r) => this.swimmable(c, r), isGoal, b.cx, b.cy);
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
