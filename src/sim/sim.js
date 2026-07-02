// BULWARK deterministic combat core.
// Pure JS, fixed-step (30 Hz), zero rendering/browser dependencies — the same
// class drives the interactive game, the replay player, and the headless
// balance harness (GDD §17/§18/§19: sim/render separation, seed determinism).
//
// All player input arrives as tick-stamped commands; (seed + command log)
// fully determines the battle. A rolling FNV hash of the state proves it.

import { makeRng, hashInit, hashNum, hashStr } from './rng.js';
import {
  EFFECTIVENESS, DAMAGE_STATUS, TOWERS, ATTACK_INTERVALS, SLICE, SLICE_ATTACKERS,
  WAVES, SIM_TICK_RATE, unitById,
} from './data.js';
import { GameMap, SLICE_LAYOUT, generateLayout, GRID_W, GRID_H } from './map.js';

const TR = SIM_TICK_RATE;
const DT = 1 / TR;
const PROJECTILE_SPEED = 11;      // tiles/sec
const LOCK_TIME_UNIT = 0.4;       // sensor→weapon telegraph (visual spec §2.1)
const LOCK_TIME_TOWER = 0.3;
const FLYER_ALTITUDE = 1.15;      // tiles, render-facing

let STATE_CODE = { building: 1, ready: 2, upgrading: 3 };

export class Sim {
  /**
   * @param {object} opts
   *   seed        — required, any int
   *   sandbox     — true disables waves & win/lose (balance harness mode)
   *   layout      — explicit board; default: the fixed slice board in sandbox
   *                 mode, otherwise a seed-generated random board (validated
   *                 for playability — see map.js). Same seed → same map, so
   *                 replays reconstruct the board for free.
   *   record      — keep a command log for replay (default true)
   */
  constructor(opts) {
    this.seed = opts.seed >>> 0;
    this.rng = makeRng(this.seed);
    this.sandbox = !!opts.sandbox;
    const layout = opts.layout || (this.sandbox ? SLICE_LAYOUT : generateLayout(this.seed).layout);
    this.map = new GameMap(layout);
    this.tick = 0;
    this.gold = SLICE.startingGold;
    this.baseHP = SLICE.baseHP;
    this.baseMaxHP = SLICE.baseHP;
    this.units = [];
    this.structures = [];
    this.projectiles = [];
    this.decals = [];                 // rubble positions (render hint, part of state)
    this.nextId = 1;
    this.events = [];
    this.wave = 0;                    // 1-based once started
    this.waveState = this.sandbox ? 'sandbox' : 'build';
    this.nextWaveAt = SLICE.buildPhaseSec * TR;
    this.spawnQueue = [];
    this.over = null;                 // 'win' | 'lose'
    this.pending = [];                // tick-stamped commands not yet executed
    this.hashAcc = hashInit();
    this.hashAcc = hashStr(this.hashAcc, layout.id); // map identity is part of the battle fingerprint
    // harness accounting (GDD §17 effective-DPS pricing)
    this.attackerDamage = 0;          // damage dealt by attackers to base+structures
    this.attackerAliveTicks = 0;
    this.log = { version: 2, seed: this.seed, mapId: layout.id, commands: [], outcome: null, ticks: 0, finalHash: null };
  }

  // ---------------------------------------------------------------- commands
  /** Live input: stamp with next tick and record. Replays call feedCommands. */
  issueCommand(cmd) {
    const stamped = { ...cmd, tick: this.tick + 1 };
    this.pending.push(stamped);
    this.log.commands.push(stamped);
    return stamped;
  }
  /** Replay input: pre-stamped commands from a recorded log. */
  feedCommands(cmds) {
    for (const c of cmds) this.pending.push({ ...c });
    this.pending.sort((a, b) => a.tick - b.tick);
  }

  emit(ev) { this.events.push(ev); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------- validation
  canPlace(kind, c, r) {
    const def = TOWERS[kind];
    if (!def) return { ok: false, why: 'unknown' };
    if (this.gold < def.cost[0]) return { ok: false, why: 'Not enough gold' };
    if (!this.map.buildable(c, r)) return { ok: false, why: 'Blocked terrain' };
    if (this.map.placementSealsPath(c, r)) return { ok: false, why: 'Would seal the lane' };
    return { ok: true };
  }

  structureAt(c, r) { return this.structures.find(s => s.c === c && s.r === r); }
  getStructure(id) { return this.structures.find(s => s.id === id); }

  // ------------------------------------------------------------------ step
  step() {
    if (this.over) return;
    this.tick++;
    this.execCommands();
    if (!this.sandbox) this.updateWaves();
    this.updateUnits();
    this.updateStructures();
    this.updateProjectiles();
    this.reap();
    if (!this.sandbox && this.baseHP <= 0 && !this.over) this.finish('lose');
    this.updateHash();
  }

  finish(outcome) {
    this.over = outcome;
    this.log.outcome = outcome;
    this.log.ticks = this.tick;
    this.log.finalHash = this.hash();
    this.emit({ t: outcome });
  }

  execCommands() {
    if (!this.pending.length) return;
    const now = [];
    this.pending = this.pending.filter(c => (c.tick <= this.tick ? (now.push(c), false) : true));
    for (const cmd of now) this.execCommand(cmd);
  }

  execCommand(cmd) {
    switch (cmd.type) {
      case 'place': {
        const v = this.canPlace(cmd.kind, cmd.c, cmd.r);
        if (!v.ok) { this.emit({ t: 'rejected', why: v.why, cmd }); return; }
        const def = TOWERS[cmd.kind];
        this.gold -= def.cost[0];
        const s = {
          id: this.nextId++, kind: cmd.kind, def, tier: 0,
          c: cmd.c, r: cmd.r, x: cmd.c + 0.5, y: cmd.r + 0.5,
          hp: def.hp[0], maxHp: def.hp[0],
          state: 'building', buildT: Math.round(def.buildTime * TR), buildTotal: Math.round(def.buildTime * TR),
          invested: def.cost[0], cooldown: 0, lockT: 0, targetId: null, aim: 0,
          repairCrew: null,
        };
        this.structures.push(s);
        this.map.setBlocked(cmd.c, cmd.r, true);
        this.emit({ t: 'placed', id: s.id, kind: s.kind, c: s.c, r: s.r });
        break;
      }
      case 'upgrade': {
        const s = this.getStructure(cmd.id);
        if (!s || s.state !== 'ready' || s.tier >= 1) return; // slice: one upgrade tier
        const price = s.def.cost[s.tier + 1] - s.def.cost[s.tier];
        if (this.gold < price) { this.emit({ t: 'rejected', why: 'Not enough gold', cmd }); return; }
        this.gold -= price;
        s.invested += price;
        s.state = 'upgrading';
        s.buildT = Math.round(s.def.buildTime * 0.8 * TR);
        s.buildTotal = s.buildT;
        this.emit({ t: 'upgradeStart', id: s.id });
        break;
      }
      case 'repair': {
        const s = this.getStructure(cmd.id);
        if (!s || s.state !== 'ready' || s.hp >= s.maxHp || s.repairCrew) return;
        if (this.gold < SLICE.repairCrewFee) { this.emit({ t: 'rejected', why: 'Not enough gold', cmd }); return; }
        this.gold -= SLICE.repairCrewFee;
        const crew = this.spawnCrew(s);
        if (crew) { s.repairCrew = crew.id; this.emit({ t: 'repairStart', id: s.id, crew: crew.id }); }
        break;
      }
      case 'sell': {
        const s = this.getStructure(cmd.id);
        if (!s) return;
        const refund = Math.round(s.invested * SLICE.sellRefundFrac);
        this.gold += refund;
        this.removeStructure(s, 'sold', refund);
        break;
      }
      case 'startWave': {
        if (this.waveState === 'build') this.beginWave();
        break;
      }
    }
  }

  removeStructure(s, why, refund = 0) {
    this.structures = this.structures.filter(x => x !== s);
    this.map.setBlocked(s.c, s.r, false);
    if (s.repairCrew) {
      const crew = this.units.find(u => u.id === s.repairCrew);
      if (crew) crew.dead = true;
    }
    if (why === 'destroyed') this.decals.push({ c: s.c, r: s.r, kind: s.kind });
    this.emit({ t: why, id: s.id, kind: s.kind, c: s.c, r: s.r, refund });
  }

  // ------------------------------------------------------------------ waves
  updateWaves() {
    if (this.waveState === 'build' && this.tick >= this.nextWaveAt) this.beginWave();
    if (this.waveState === 'active') {
      while (this.spawnQueue.length && this.spawnQueue[0].tick <= this.tick) {
        this.spawnAttacker(this.spawnQueue.shift());
      }
      if (!this.spawnQueue.length && !this.units.some(u => u.side === 'enemy' && !u.dead)) {
        // wave cleared
        this.gold += SLICE.waveClearBounty;
        this.emit({ t: 'waveClear', wave: this.wave, bounty: SLICE.waveClearBounty });
        if (this.wave >= WAVES.length) { this.finish('win'); return; }
        this.waveState = 'build';
        this.nextWaveAt = this.tick + SLICE.buildPhaseSec * TR;
      }
    }
  }

  beginWave() {
    this.wave++;
    this.waveState = 'active';
    const def = WAVES[this.wave - 1];
    // Expand [kind,count] pairs round-robin; pre-draw ALL rng for the wave so
    // the stream never depends on mid-wave state.
    const counts = def.spawns.map(([kind, n]) => ({ kind, n }));
    const order = [];
    let left = counts.reduce((a, b) => a + b.n, 0);
    let i = 0;
    while (left > 0) {
      const c = counts[i % counts.length];
      if (c.n > 0) { order.push(c.kind); c.n--; left--; }
      i++;
    }
    let t = this.tick + Math.round(1.0 * TR);
    this.spawnQueue = order.map(kind => {
      const gap = Math.round(this.rng.range(0.9, 1.6) * TR);
      const entry = {
        kind, tick: t,
        rowPick: this.rng.next(),
        jx: this.rng.range(-0.15, 0.15),
        jy: this.rng.range(-0.3, 0.3),
      };
      t += gap;
      return entry;
    });
    this.emit({ t: 'waveStart', wave: this.wave, name: def.name, count: order.length });
  }

  spawnAttacker(entry) {
    const spec = SLICE_ATTACKERS[entry.kind];
    const def = unitById(spec.unit);
    const domain = spec.domain;
    let c = 0, r;
    const lay = this.map.layout;
    if (domain === 'Walker') r = lay.spawns.ground.rows[Math.floor(entry.rowPick * lay.spawns.ground.rows.length)];
    else if (domain === 'Floater' || domain === 'Swimmer') r = lay.spawns.water.rows[Math.floor(entry.rowPick * lay.spawns.water.rows.length)];
    else r = lay.spawns.air.min + Math.floor(entry.rowPick * (lay.spawns.air.max - lay.spawns.air.min + 1)); // flyer: any lane
    const u = this.makeUnit(def, domain, c, r, entry, spec);
    this.units.push(u);
    this.emit({ t: 'spawn', id: u.id, kind: entry.kind, unit: def.id, domain, x: u.x, y: u.y });
  }

  makeUnit(def, domain, c, r, entry, spec = {}) {
    const u = {
      id: this.nextId++, side: 'enemy', kind: entry.kind, def, domain,
      shape: def.shape, armor: def.armor, dmgType: def.dmgType,
      tier: 0, hp: def.hp[0], maxHp: def.hp[0],
      x: c + 0.35 + (entry.jx || 0), y: r + 0.5 + (entry.jy || 0),
      prevX: 0, prevY: 0,
      speed: def.speed, range: def.range,
      dps: def.dps[0],
      interval: ATTACK_INTERVALS[def.shape] || 1,
      bounty: Math.round(def.cost[0] * SLICE.incomePerKillFrac),
      targetsStructures: !!spec.targetsStructures,
      label: spec.label || def.shape,
      path: null, pathIdx: 0, pathVersion: -1,
      state: 'moving', targetId: null, lockT: 0, cooldown: 0,
      aim: 0, headAim: 0,
      slowT: 0, slowF: 1, dotT: 0, dotDps: 0, dotType: null, stunT: 0,
      altitude: domain === 'Flyer' ? FLYER_ALTITUDE : 0,
      dead: false,
    };
    u.prevX = u.x; u.prevY = u.y;
    return u;
  }

  spawnCrew(target) {
    // repair crew marches out from the base (visual spec §8: troops deploy from base)
    const start = this.nearestWalkableAroundBase(target.c, target.r);
    if (!start) return null;
    const u = {
      id: this.nextId++, side: 'player', kind: 'crew', def: null, domain: 'Walker',
      shape: 'Crew', armor: 'Organic', dmgType: null,
      tier: 0, hp: 60, maxHp: 60,
      x: start[0] + 0.5, y: start[1] + 0.5, prevX: 0, prevY: 0,
      speed: SLICE.repairCrewSpeed, range: 0.2, dps: 0, interval: 1, bounty: 0,
      targetsStructures: false, label: 'Repair Crew',
      path: null, pathIdx: 0, pathVersion: -1,
      state: 'moving', targetId: target.id, lockT: 0, cooldown: 0,
      aim: 0, headAim: 0, slowT: 0, slowF: 1, dotT: 0, dotDps: 0, dotType: null, stunT: 0,
      altitude: 0, dead: false,
    };
    u.prevX = u.x; u.prevY = u.y;
    this.units.push(u);
    return u;
  }

  nearestWalkableAroundBase(tc, tr) {
    let best = null, bestD = Infinity;
    const b = this.map.layout.base;
    for (let c = b.c0 - 1; c <= b.c1 + 1; c++) {
      for (let r = b.r0 - 1; r <= b.r1 + 1; r++) {
        if (!this.map.walkable(c, r)) continue;
        const d = Math.hypot(c - tc, r - tr);
        if (d < bestD) { bestD = d; best = [c, r]; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ units
  updateUnits() {
    for (const u of this.units) {
      if (u.dead) continue;
      u.prevX = u.x; u.prevY = u.y;
      if (u.side === 'enemy') this.attackerAliveTicks++;

      // status effects
      if (u.dotT > 0) {
        u.dotT--;
        this.applyDamage(u, u.dotDps * DT, u.dotType, null, true);
        if (u.dead) continue;
      }
      if (u.slowT > 0) u.slowT--;
      if (u.stunT > 0) { u.stunT--; continue; }

      if (u.side === 'player') { this.updateCrew(u); continue; }

      // ---- target/goal selection
      if (u.targetsStructures) {
        const tgt = this.nearestStructure(u);
        if (tgt) {
          const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
          if (d <= u.range) { this.attackTick(u, { kind: 'structure', obj: tgt }); continue; }
          this.moveToward(u, tgt.x, tgt.y);
          continue;
        }
        // fall through to base attack when nothing left to raid
      }
      const dBase = this.map.distToBase(u.x, u.y);
      if (dBase <= u.range) { this.attackTick(u, { kind: 'base' }); continue; }
      this.moveAlongDomain(u);
    }
  }

  nearestStructure(u) {
    let best = null, bestD = Infinity;
    for (const s of this.structures) {
      const d = Math.hypot(s.x - u.x, s.y - u.y);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && s.id < best.id)) { bestD = d; best = s; }
    }
    return best;
  }

  moveAlongDomain(u) {
    if (u.domain === 'Flyer') {
      const [bx, by] = this.map.closestPointOnBase(u.x, u.y);
      this.moveToward(u, bx, by);
      return;
    }
    // Walkers / floaters / swimmers follow grid paths; re-path when the maze changes.
    if (u.pathVersion !== this.map.version || !u.path) {
      const c = Math.min(GRID_W - 1, Math.max(0, Math.floor(u.x)));
      const r = Math.min(GRID_H - 1, Math.max(0, Math.floor(u.y)));
      u.path = (u.domain === 'Walker') ? this.map.walkerPath(c, r) : this.map.waterPath(c, r);
      u.pathIdx = 1;
      u.pathVersion = this.map.version;
      if (u.path) this.emit({ t: 'repath', id: u.id });
    }
    if (!u.path) {
      // Trapped in a pocket (spawn→base stays connected, but this unit got
      // boxed in): fight out through the nearest structure like a flagged unit.
      const tgt = this.nearestStructure(u);
      if (tgt) {
        const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
        if (d <= Math.max(u.range, 1.2)) this.attackTick(u, { kind: 'structure', obj: tgt });
        else this.moveToward(u, tgt.x, tgt.y);
      }
      return;
    }
    if (u.pathIdx >= u.path.length) {
      // path exhausted but still out of range: walkers nudge toward the base;
      // floaters hold station at the lane end (their path goal is already
      // within strike range, so this is a float-precision edge at most)
      if (u.domain === 'Walker') {
        const [bx, by] = this.map.closestPointOnBase(u.x, u.y);
        this.moveToward(u, bx, by);
      }
      return;
    }
    const [wc, wr] = u.path[u.pathIdx];
    const tx = wc + 0.5, ty = wr + 0.5;
    if (Math.hypot(tx - u.x, ty - u.y) < 0.12) { u.pathIdx++; return; }
    this.moveToward(u, tx, ty);
  }

  moveToward(u, tx, ty) {
    u.state = 'moving';
    const dx = tx - u.x, dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const slow = (u.slowT > 0 && u.domain !== 'Flyer') ? u.slowF : 1; // frost never slows air
    const step = Math.min(d, u.speed * slow * DT);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    u.aim = Math.atan2(dy, dx);
    u.headAim = u.aim;
  }

  attackTick(u, target) {
    if (u.state !== 'attacking' || u.attackTargetKind !== target.kind ||
        (target.obj && u.targetId !== target.obj.id)) {
      u.state = 'attacking';
      u.attackTargetKind = target.kind;
      u.targetId = target.obj ? target.obj.id : null;
      u.lockT = Math.round(LOCK_TIME_UNIT * TR);   // sensors lead, weapon follows
    }
    let tx, ty;
    if (target.kind === 'base') { [tx, ty] = this.map.closestPointOnBase(u.x, u.y); }
    else { tx = target.obj.x; ty = target.obj.y; }
    u.headAim = Math.atan2(ty - u.y, tx - u.x);
    if (u.lockT > 0) { u.lockT--; u.aim += (u.headAim - u.aim) * 0.3; return; }
    u.aim = u.headAim;
    if (u.cooldown > 0) { u.cooldown--; return; }
    u.cooldown = Math.round(u.interval * TR);
    const dmg = u.dps * u.interval;
    this.projectiles.push({
      id: this.nextId++, x: u.x, y: u.y, sx: u.x, sy: u.y,
      targetKind: target.kind, targetId: target.obj ? target.obj.id : null,
      lastX: tx, lastY: ty,
      speed: PROJECTILE_SPEED, dmg, dmgType: u.dmgType, aoe: u.def ? u.def.aoe : 0,
      side: 'enemy', srcId: u.id, srcAlt: u.altitude,
    });
    this.emit({ t: 'shot', id: u.id, x: u.x, y: u.y, tx, ty, side: 'enemy', shape: u.shape });
  }

  updateCrew(u) {
    const s = this.getStructure(u.targetId);
    if (!s) { u.dead = true; this.emit({ t: 'crewDone', id: u.id }); return; }
    const d = Math.hypot(s.x - u.x, s.y - u.y);
    if (d > 1.05) {
      // walk to the structure (path around walls/water)
      if (u.pathVersion !== this.map.version || !u.path) {
        const c = Math.floor(u.x), r = Math.floor(u.y);
        const goal = (gc, gr) => Math.abs(gc - s.c) + Math.abs(gr - s.r) === 1 && this.map.walkable(gc, gr);
        u.path = this.map.findPath(c, r, (cc, rr) => this.map.walkable(cc, rr), goal, s.c, s.r);
        u.pathIdx = 1; u.pathVersion = this.map.version;
      }
      if (u.path && u.pathIdx < u.path.length) {
        const [wc, wr] = u.path[u.pathIdx];
        if (Math.hypot(wc + 0.5 - u.x, wr + 0.5 - u.y) < 0.12) u.pathIdx++;
        else this.moveToward(u, wc + 0.5, wr + 0.5);
      } else {
        this.moveToward(u, s.x, s.y);
      }
      return;
    }
    // arrived: channel the repair
    u.state = 'repairing';
    s.hp = Math.min(s.maxHp, s.hp + SLICE.repairRate * DT);
    if (s.hp >= s.maxHp) {
      s.repairCrew = null;
      u.dead = true;
      this.emit({ t: 'repairDone', id: s.id, c: s.c, r: s.r });
      this.emit({ t: 'crewDone', id: u.id });
    }
  }

  // ------------------------------------------------------------- structures
  updateStructures() {
    // radar coverage for this tick (radar sees air, not ground — GDD §5)
    const bb = this.map.layout.base;
    const radars = [{ x: bb.cx, y: bb.cy, r: SLICE.baseRadar }];
    for (const s of this.structures) {
      if (s.kind === 'flak' && s.state === 'ready') radars.push({ x: s.x, y: s.y, r: s.def.radar });
    }
    this.radarsThisTick = radars;

    for (const s of this.structures) {
      if (s.state === 'building' || s.state === 'upgrading') {
        s.buildT--;
        if (s.buildT <= 0) {
          if (s.state === 'upgrading') {
            const ratio = s.hp / s.maxHp;
            s.tier++;
            s.maxHp = s.def.hp[s.tier];
            s.hp = Math.round(s.maxHp * ratio);
            this.emit({ t: 'upgradeDone', id: s.id, tier: s.tier, c: s.c, r: s.r });
          } else {
            this.emit({ t: 'buildDone', id: s.id, kind: s.kind, c: s.c, r: s.r });
          }
          s.state = 'ready';
        }
        continue;
      }
      if (!s.def.canTarget) continue;
      this.towerCombat(s);
    }
  }

  flyerDetected(u) {
    for (const rad of this.radarsThisTick) {
      if (Math.hypot(u.x - rad.x, u.y - rad.y) <= rad.r) return true;
    }
    return false;
  }

  towerCombat(s) {
    const range = s.def.range;
    // validate current target
    let target = s.targetId ? this.units.find(u => u.id === s.targetId && !u.dead) : null;
    if (target) {
      const d = Math.hypot(target.x - s.x, target.y - s.y);
      const stillValid = d <= range + 0.25 &&
        (s.def.canTarget === 'Air' ? (target.domain === 'Flyer' && this.flyerDetected(target)) : target.domain !== 'Flyer');
      if (!stillValid) target = null;
    }
    if (!target) {
      let bestD = Infinity;
      for (const u of this.units) {
        if (u.dead || u.side !== 'enemy') continue;
        if (s.def.canTarget === 'Air') {
          if (u.domain !== 'Flyer' || !this.flyerDetected(u)) continue;
        } else {
          if (u.domain === 'Flyer') continue;
        }
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d > range) continue;
        const prio = this.map.distToBase(u.x, u.y); // shoot what's closest to breaching
        if (prio < bestD - 1e-9 || (Math.abs(prio - bestD) < 1e-9 && (!target || u.id < target.id))) {
          bestD = prio; target = u;
        }
      }
      if (target && target.id !== s.targetId) {
        s.targetId = target.id;
        s.lockT = Math.round(LOCK_TIME_TOWER * TR); // lock-on wind-up
        this.emit({ t: 'lock', id: s.id, target: target.id });
      } else if (!target) {
        s.targetId = null;
      }
    }
    if (!target) return;
    s.aim = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.lockT > 0) { s.lockT--; return; }
    if (s.cooldown > 0) { s.cooldown--; return; }
    const interval = ATTACK_INTERVALS[s.kind];
    s.cooldown = Math.round(interval * TR);
    const dmg = s.def.dps[s.tier] * interval;
    this.projectiles.push({
      id: this.nextId++, x: s.x, y: s.y, sx: s.x, sy: s.y,
      targetKind: 'unit', targetId: target.id, lastX: target.x, lastY: target.y,
      speed: PROJECTILE_SPEED + (s.kind === 'flak' ? 4 : 0),
      dmg, dmgType: s.def.dmgType, aoe: s.def.aoe, side: 'player', srcId: s.id,
      vsAir: s.def.canTarget === 'Air',
    });
    this.emit({ t: 'shot', id: s.id, x: s.x, y: s.y, tx: target.x, ty: target.y, side: 'player', shape: s.kind });
  }

  // ------------------------------------------------------------ projectiles
  updateProjectiles() {
    const alive = [];
    for (const p of this.projectiles) {
      // home on live target; remember last position if it dies mid-flight
      let tx = p.lastX, ty = p.lastY, targetObj = null;
      if (p.targetKind === 'unit') {
        targetObj = this.units.find(u => u.id === p.targetId && !u.dead);
        if (targetObj) { tx = targetObj.x; ty = targetObj.y; p.lastX = tx; p.lastY = ty; }
      } else if (p.targetKind === 'structure') {
        targetObj = this.getStructure(p.targetId);
        if (targetObj) { tx = targetObj.x; ty = targetObj.y; p.lastX = tx; p.lastY = ty; }
      } else if (p.targetKind === 'base') {
        targetObj = 'base';
      }
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * DT;
      if (d <= step + 0.1) {
        this.impact(p, targetObj, tx, ty);
        continue;
      }
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      alive.push(p);
    }
    this.projectiles = alive;
  }

  impact(p, targetObj, x, y) {
    this.emit({ t: 'impact', x, y, dmgType: p.dmgType, side: p.side, air: !!p.vsAir });
    if (p.targetKind === 'base') {
      const eff = EFFECTIVENESS[p.dmgType] ? EFFECTIVENESS[p.dmgType]['Structure'] : 1;
      const dealt = p.dmg * eff;
      this.baseHP = Math.max(0, this.baseHP - dealt);
      this.attackerDamage += dealt;
      this.emit({ t: 'baseHit', dmg: dealt, hp: this.baseHP });
      return;
    }
    if (p.targetKind === 'structure') {
      const s = targetObj;
      if (s) {
        const eff = EFFECTIVENESS[p.dmgType] ? EFFECTIVENESS[p.dmgType][s.def.armor] : 1;
        const dealt = p.dmg * eff;
        s.hp -= dealt;
        this.attackerDamage += dealt;
        this.emit({ t: 'structHit', id: s.id, dmg: dealt, hp: s.hp });
        if (s.hp <= 0) this.removeStructure(s, 'destroyed');
      }
      return;
    }
    // unit impact (+ splash within same targetable class)
    if (targetObj) this.applyDamage(targetObj, p.dmg, p.dmgType, p);
    if (p.aoe > 0) {
      for (const u of this.units) {
        if (u.dead || u === targetObj) continue;
        if (p.side === 'player' && u.side !== 'enemy') continue;
        if (p.vsAir !== (u.domain === 'Flyer')) continue;
        if (Math.hypot(u.x - x, u.y - y) <= p.aoe) this.applyDamage(u, p.dmg * 0.5, p.dmgType, p);
      }
    }
  }

  applyDamage(u, raw, dmgType, proj, isDot = false) {
    if (u.dead) return;
    const eff = dmgType && EFFECTIVENESS[dmgType] ? EFFECTIVENESS[dmgType][u.armor] : 1;
    let dealt = raw * eff;
    if (u.domain === 'Swimmer') dealt *= SLICE.subSurfaceDamageTaken; // sub-surface: harder to hit
    u.hp -= dealt;
    if (!isDot && dmgType) this.applyStatus(u, dealt, dmgType);
    if (u.hp <= 0) {
      u.dead = true;
      if (u.side === 'enemy') {
        this.gold += u.bounty;
        this.emit({ t: 'death', id: u.id, x: u.x, y: u.y, domain: u.domain, shape: u.shape });
        this.emit({ t: 'coin', x: u.x, y: u.y, amount: u.bounty });
      } else {
        this.emit({ t: 'crewDone', id: u.id });
      }
    }
  }

  applyStatus(u, dealt, dmgType) {
    const st = DAMAGE_STATUS[dmgType];
    if (!st) return;
    if (st.dotFrac) {
      u.dotT = Math.round(st.duration * TR);
      u.dotDps = (dealt * st.dotFrac) / st.duration;
      u.dotType = dmgType;
    }
    if (st.slowFactor && !(st.noSlowVsAir && u.domain === 'Flyer')) {
      u.slowT = Math.round(st.duration * TR);
      u.slowF = st.slowFactor;
    }
    if (st.stunMachinery && u.armor === 'Machinery') {
      u.stunT = Math.max(u.stunT, Math.round(st.stunMachinery * TR));
    }
  }

  reap() {
    this.units = this.units.filter(u => !u.dead);
  }

  // ------------------------------------------------------------------- hash
  updateHash() {
    let h = this.hashAcc;
    h = hashNum(h, this.tick);
    h = hashNum(h, this.gold);
    h = hashNum(h, this.baseHP);
    for (const u of this.units) { h = hashNum(h, u.id); h = hashNum(h, u.x); h = hashNum(h, u.y); h = hashNum(h, u.hp); }
    for (const s of this.structures) { h = hashNum(h, s.id); h = hashNum(h, s.hp); h = hashNum(h, s.tier); h = hashNum(h, STATE_CODE[s.state] || 0); }
    for (const p of this.projectiles) { h = hashNum(h, p.id); h = hashNum(h, p.x); h = hashNum(h, p.y); }
    this.hashAcc = h;
  }
  hash() { return ('0000000' + this.hashAcc.toString(16)).slice(-8); }

  // ------------------------------------------------- harness helpers (§17)
  /** Directly field one attacker (balance-harness use; bypasses waves). */
  harnessSpawn(unitId, { domain = null, tier = 0, row = null, targetsStructures = false } = {}) {
    const def = unitById(unitId);
    if (!def) throw new Error('unknown unit ' + unitId);
    const dom = domain || def.domain;
    // seeded spawn variation so independent runs genuinely differ (§17 grade (d))
    const pick = this.rng.next();
    const jx = this.rng.range(-0.15, 0.15), jy = this.rng.range(-0.3, 0.3);
    let r;
    const lay = this.map.layout;
    if (dom === 'Walker') r = row ?? lay.spawns.ground.rows[Math.floor(pick * lay.spawns.ground.rows.length)];
    else if (dom === 'Floater' || dom === 'Swimmer') r = row ?? lay.spawns.water.rows[Math.floor(pick * lay.spawns.water.rows.length)];
    else r = row ?? lay.spawns.air.min + Math.floor(pick * (lay.spawns.air.max - lay.spawns.air.min + 1));
    const u = this.makeUnit(def, dom, 0, r, { kind: unitId, rowPick: pick, jx, jy },
      { targetsStructures: targetsStructures || def.targets === 'Structures' });
    u.tier = tier;
    u.hp = u.maxHp = def.hp[tier];
    u.dps = def.dps[tier];
    this.units.push(u);
    return u;
  }
  /** Instantly place a ready structure (harness fixed defense set). */
  harnessPlace(kind, c, r, tier = 0) {
    const def = TOWERS[kind];
    const s = {
      id: this.nextId++, kind, def, tier, c, r, x: c + 0.5, y: r + 0.5,
      hp: def.hp[tier], maxHp: def.hp[tier], state: 'ready',
      buildT: 0, buildTotal: 1, invested: def.cost[tier], cooldown: 0, lockT: 0,
      targetId: null, aim: 0, repairCrew: null,
    };
    this.structures.push(s);
    this.map.setBlocked(c, r, true);
    return s;
  }
}

export { TR as TICK_RATE, DT as TICK_DT, GRID_W, GRID_H, FLYER_ALTITUDE };
