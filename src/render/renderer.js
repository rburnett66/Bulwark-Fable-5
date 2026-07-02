// Renderer/orchestrator. Owns the PIXI app, the rotatable world (layers 2–13
// of the canonical z-order), camera, per-frame view sync with interpolation,
// and translation of sim events into FX + SFX. The HUD is DOM (never rotates).

/* global PIXI */
import { GRID_W, GRID_H, SLICE_LAYOUT } from '../sim/map.js';
import { PALETTE, TOWERS } from '../sim/data.js';
import { TILE, buildTerrain } from './terrain.js';
import { UnitView } from './units.js';
import { StructureView, PlacementUI } from './structures.js';
import { Particles, FxManager, drawProjectiles } from './fx.js';
import { Sfx } from '../audio.js';

const BOARD_W = GRID_W * TILE, BOARD_H = GRID_H * TILE;

export class Renderer {
  constructor(canvasHost, layout = SLICE_LAYOUT) {
    this.layout = layout;
    this.app = new PIXI.Application({
      background: 0x0c141c, antialias: true,
      resizeTo: canvasHost, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    canvasHost.appendChild(this.app.view);

    // ---- rotatable world + layer stack (visual spec §1) ----
    this.world = new PIXI.Container();
    this.world.pivot.set(BOARD_W / 2, BOARD_H / 2);
    this.app.stage.addChild(this.world);

    const L = this.layers = {
      water: new PIXI.Container(),      // 2
      ground: new PIXI.Container(),     // 3
      shadows: new PIXI.Container(),    // 4  (everything casts here)
      grass: new PIXI.Container(),      // 5  (+ rubble decals)
      main: new PIXI.Container(),       // 6-8 trees, ground units, structures (depth-sorted)
      groundFx: new PIXI.Container(),   // 9  dirt, ripples, projectiles
      air: new PIXI.Container(),        // 10 flyers
      clouds: new PIXI.Container(),     // 11
      fx: new PIXI.Container(),         // 12 muzzle/impact/pie/coins
      fog: new PIXI.Container(),        // 13
    };
    // ground first, then water on top of nothing — actually water below ground
    // per z-order (water 2, ground 3) — the ground never overlaps the lane.
    this.world.addChild(L.water, L.ground, L.shadows, L.grass, L.main, L.groundFx, L.air, L.clouds, L.fx, L.fog);
    L.main.sortableChildren = true;

    this.terrain = buildTerrain(L, layout);
    this.particles = new Particles(L);
    this.fx = new FxManager(L);
    this.placementUI = new PlacementUI(L);
    this.projG = new PIXI.Graphics();
    L.groundFx.addChild(this.projG);

    // fog-of-war vignette at the hostile map edge (minimal slice fog; the
    // full continent-level FoW is a stub — see README spec map)
    const fog = new PIXI.Graphics();
    for (let i = 0; i < 14; i++) {
      fog.beginFill(PALETTE.fog, 0.028 * (14 - i));
      fog.drawRect(i * 14, -60, 14, BOARD_H + 120);
      fog.endFill();
    }
    L.fog.addChild(fog);

    // camera state
    this.cam = { rot: 0, targetRot: 0, zoom: 1, targetZoom: 1, cinematic: 0 };
    this.unitViews = new Map();
    this.structViews = new Map();
    this.rubbleDrawn = new Set();
    this.tSec = 0;
    this.shake = 0;

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = this.app.screen.width, h = this.app.screen.height;
    this.world.position.set(w / 2, h / 2 + 10);
    this.baseZoom = Math.min((w - 30) / BOARD_W, (h - 130) / BOARD_H);
  }

  startCinematic() { this.cam.cinematic = 4.2; this.cam.rot = -0.5; }
  skipCinematic() { this.cam.cinematic = 0; }

  rotate(dir) { this.cam.targetRot += dir * 0.35; }
  zoom(f) { this.cam.targetZoom = Math.min(2.2, Math.max(0.65, this.cam.targetZoom * f)); }
  resetCamera() { this.cam.targetRot = 0; this.cam.targetZoom = 1; }

  /** screen point → tile coords */
  screenToTile(sx, sy) {
    const p = this.world.toLocal(new PIXI.Point(sx, sy));
    return { x: p.x / TILE, y: p.y / TILE, c: Math.floor(p.x / TILE), r: Math.floor(p.y / TILE) };
  }
  tileToScreen(x, y) {
    return this.world.toGlobal(new PIXI.Point(x * TILE, y * TILE));
  }

  // ---- sim event → FX/SFX dispatch ----
  handleEvents(events, sim, muteish = false) {
    for (const ev of events) {
      switch (ev.t) {
        case 'shot': {
          const x = ev.x * TILE, y = ev.y * TILE;
          const ang = Math.atan2(ev.ty - ev.y, ev.tx - ev.x);
          this.particles.muzzle(x, y, ang, ev.shape === 'cannon');
          const v = ev.side === 'player' ? this.structViews.get(ev.id) : this.unitViews.get(ev.id);
          if (v) v.onShot();
          if (ev.side === 'player') (ev.shape === 'flak' ? Sfx.flak : Sfx.cannon)();
          else Sfx.enemyShot();
          break;
        }
        case 'impact':
          this.particles.impact(ev.x * TILE, ev.y * TILE, ev.dmgType, ev.air);
          (ev.air ? Sfx.flakBurst : Sfx.impact)();
          break;
        case 'death': {
          const x = ev.x * TILE, y = ev.y * TILE;
          if (ev.domain === 'Floater' || ev.domain === 'Swimmer') { this.particles.splash(x, y); Sfx.splash(); }
          else { this.particles.explosion(x, y, ev.shape !== 'Troops'); Sfx.explosion(); }
          break;
        }
        case 'coin':
          this.fx.coin(ev.x * TILE, ev.y * TILE - 14, ev.amount, () => this.world.rotation);
          Sfx.coin();
          break;
        case 'baseHit': {
          const b = this.layout.base;
          this.particles.explosion(b.cx * TILE + (Math.random() - 0.5) * 40, b.cy * TILE + (Math.random() - 0.5) * 40);
          this.particles.smoke(b.cx * TILE, b.cy * TILE - 20);
          this.shake = Math.min(8, this.shake + 2.5);
          Sfx.baseHit();
          break;
        }
        case 'placed': Sfx.place(); break;
        case 'buildDone':
        case 'upgradeDone':
        case 'repairDone':
          this.fx.pieSweep((ev.c + 0.5) * TILE, (ev.r + 0.5) * TILE);
          Sfx.pieSweep();
          break;
        case 'destroyed': {
          const x = (ev.c + 0.5) * TILE, y = (ev.r + 0.5) * TILE;
          this.particles.explosion(x, y, true);
          this.fx.rubble(x, y);
          this.shake = Math.min(10, this.shake + 4);
          Sfx.explosion();
          break;
        }
        case 'sold':
          this.particles.sellPuff((ev.c + 0.5) * TILE, (ev.r + 0.5) * TILE);
          this.fx.coin((ev.c + 0.5) * TILE, (ev.r + 0.5) * TILE, ev.refund, () => this.world.rotation);
          Sfx.sell();
          break;
        case 'waveStart': Sfx.waveHorn(); break;
        case 'win': Sfx.win(); break;
        case 'lose': Sfx.lose(); break;
        case 'rejected': Sfx.invalid(); break;
      }
    }
  }

  // ---- per-frame sync ----
  draw(sim, alpha, dtSec) {
    this.tSec += dtSec;
    const cam = this.cam;

    // cinematic intro: slow auto-rotate framing base ← threat axis (spec §7)
    if (cam.cinematic > 0) {
      cam.cinematic -= dtSec;
      const k = Math.max(0, cam.cinematic / 4.2);
      cam.rot = -0.5 * easeInOut(k);
      cam.targetRot = 0;
      cam.zoom = this.baseZoom ? (1 + 0.25 * easeInOut(k)) : 1;
      cam.targetZoom = 1;
    } else {
      cam.rot += (cam.targetRot - cam.rot) * Math.min(1, dtSec * 5);
      cam.zoom += (cam.targetZoom - cam.zoom) * Math.min(1, dtSec * 6);
    }
    this.world.rotation = cam.rot;
    this.world.scale.set(this.baseZoom * cam.zoom);
    if (this.shake > 0) {
      this.shake -= dtSec * 14;
      const s = Math.max(0, this.shake);
      this.world.position.set(
        this.app.screen.width / 2 + (Math.random() - 0.5) * s,
        this.app.screen.height / 2 + 10 + (Math.random() - 0.5) * s,
      );
    }

    this.terrain.update(dtSec, this.tSec);

    const rot = this.world.rotation;
    const sinR = Math.sin(rot), cosR = Math.cos(rot);
    const sortY = (x, y) => x * sinR + y * cosR;

    // depth-sort static occluders (trees, base) too
    for (const ch of this.layers.main.children) {
      if (ch._anchorY !== undefined) ch.zIndex = sortY(ch.position ? ch.position.x : 0, ch._anchorY);
    }

    // ---- units ----
    const seen = new Set();
    for (const u of sim.units) {
      seen.add(u.id);
      let v = this.unitViews.get(u.id);
      if (!v) { v = new UnitView(u, this.layers, this.particles); this.unitViews.set(u.id, v); }
      const ix = (u.prevX + (u.x - u.prevX) * alpha) * TILE;
      const iy = (u.prevY + (u.y - u.prevY) * alpha) * TILE;
      const moving = u.state === 'moving' && (Math.abs(u.x - u.prevX) + Math.abs(u.y - u.prevY)) > 1e-5;
      v.update({
        x: ix, y: iy, aim: u.aim, headAim: u.headAim, moving,
        lock01: u.state === 'attacking' && u.lockT > 0 ? 1 - u.lockT / (0.4 * 30) : 0,
        hp01: u.hp / u.maxHp, alt: u.altitude, worldRot: rot,
        sortY: sortY(ix, iy),
      }, dtSec, this.tSec);
    }
    for (const [id, v] of this.unitViews) {
      if (!seen.has(id)) { v.destroy(); this.unitViews.delete(id); }
    }

    // ---- structures ----
    seen.clear();
    for (const s of sim.structures) {
      seen.add(s.id);
      let v = this.structViews.get(s.id);
      if (!v) { v = new StructureView(s, this.layers, this.particles); this.structViews.set(s.id, v); }
      if (v.tier !== s.tier) v.redraw(s.tier);
      v.update(s, {
        hp01: s.hp / s.maxHp,
        buildProgress: s.buildTotal ? 1 - s.buildT / s.buildTotal : 1,
        worldRot: rot,
        sortY: sortY(s.x * TILE, s.y * TILE + TILE * 0.4),
      }, dtSec, this.tSec);
    }
    for (const [id, v] of this.structViews) {
      if (!seen.has(id)) { v.destroy(); this.structViews.delete(id); }
    }

    drawProjectiles(this.projG, sim, alpha);
    this.particles.update(dtSec);
    this.fx.update(dtSec);
  }

  destroy() {
    this.app.destroy(true, { children: true });
  }
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
