// The slice board (GDD §19.1 / §17 harness geometry): one ground lane beside
// one water lane, ending at the player base in a clearing. Pure data + A* —
// no rendering here.

export const GRID_W = 26;
export const GRID_H = 15;

export const WATER_ROWS = [9, 10, 11];

// Base footprint: 2×2 tiles, cols 22-23, rows 7-8. Row 8 borders the water
// band so floaters can strike it from the lane.
export const BASE = { c0: 22, r0: 7, c1: 23, r1: 8, cx: 23, cy: 8.5 };

export const SPAWNS = {
  ground: { c: 0, rows: [3, 4, 5] },
  water:  { c: 0, rows: [9, 10, 11] },
  air:    { c: 0, rows: [1, 13] },       // any row in range (seeded)
};

// Fixed decor trees — block building AND walker pathing (terrain routes lanes).
export const TREES = [
  [6, 1], [7, 2], [11, 1], [16, 2], [20, 1], [4, 7], [9, 13], [14, 13], [19, 13], [24, 3],
];

export function isWater(c, r) { return r >= WATER_ROWS[0] && r <= WATER_ROWS[WATER_ROWS.length - 1]; }
export function inBounds(c, r) { return c >= 0 && c < GRID_W && r >= 0 && r < GRID_H; }
export function inBase(c, r) { return c >= BASE.c0 && c <= BASE.c1 && r >= BASE.r0 && r <= BASE.r1; }
export function isTree(c, r) { return TREES.some(([tc, tr]) => tc === c && tr === r); }

// Distance from a point (tile coords) to the base rectangle edge.
export function distToBase(x, y) {
  const dx = Math.max(BASE.c0 - x, 0, x - (BASE.c1 + 1));
  const dy = Math.max(BASE.r0 - y, 0, y - (BASE.r1 + 1));
  return Math.hypot(dx, dy);
}

export function closestPointOnBase(x, y) {
  return [Math.min(Math.max(x, BASE.c0), BASE.c1 + 1), Math.min(Math.max(y, BASE.r0), BASE.r1 + 1)];
}

export class GameMap {
  constructor() {
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

  walkable(c, r) {
    return inBounds(c, r) && !isWater(c, r) && !isTree(c, r) && !this.isBlocked(c, r) && !inBase(c, r);
  }
  swimmable(c, r) { return inBounds(c, r) && isWater(c, r) && !this.isBlocked(c, r); }

  buildable(c, r) {
    return inBounds(c, r) && !isWater(c, r) && !isTree(c, r) && !inBase(c, r) &&
      !this.isBlocked(c, r) && c >= 2 && c <= GRID_W - 2;
  }

  // A* over the grid, 4-directional, deterministic tie-breaks.
  // pass: (c,r)=>bool ; goal: (c,r)=>bool ; heuristic target (tx,ty)
  findPath(sc, sr, pass, isGoal, tx, ty) {
    if (isGoal(sc, sr)) return [[sc, sr]];
    const open = [];   // binary-heap-free: small grid, use sorted insert via array scan
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
        if (!pass(nc, nr) && !isGoal(nc, nr)) continue;
        if (!inBounds(nc, nr)) continue;
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

  // Walker path from spawn cell to any cell adjacent to the base rect.
  walkerPath(sc, sr) {
    const isGoal = (c, r) =>
      inBounds(c, r) && !isWater(c, r) && !this.isBlocked(c, r) && !isTree(c, r) && !inBase(c, r) &&
      c >= BASE.c0 - 1 && c <= BASE.c1 + 1 && r >= BASE.r0 - 1 && r <= BASE.r1 + 1;
    return this.findPath(sc, sr, (c, r) => this.walkable(c, r), isGoal, BASE.cx, BASE.cy);
  }

  waterPath(sc, sr) {
    // goal: water cell nearest the base (east end of the lane under the clearing)
    const isGoal = (c, r) => isWater(c, r) && c >= BASE.c0 && c <= BASE.c1 + 1;
    return this.findPath(sc, sr, (c, r) => this.swimmable(c, r), isGoal, BASE.cx, WATER_ROWS[0]);
  }

  // Would placing a blocker at (c,r) sever the ground lane? (classic TD rule:
  // the maze may reroute but never seal)
  placementSealsPath(c, r) {
    this.blocked.add(this.key(c, r));
    let ok = true;
    for (const row of SPAWNS.ground.rows) {
      if (!this.walkerPath(SPAWNS.ground.c, row)) { ok = false; break; }
    }
    this.blocked.delete(this.key(c, r));
    return !ok;
  }
}
