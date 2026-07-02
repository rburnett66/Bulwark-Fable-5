// Combat & lifecycle FX: three-part shots (muzzle → tracer → impact), dirt,
// wakes/ripples, smoke, debris, the gold pie-sweep, coin pickups, banners.

/* global PIXI */
import { PALETTE } from '../sim/data.js';
import { TILE } from './terrain.js';

const MAX_PARTICLES = 900;

export class Particles {
  constructor(layers) {
    this.pool = [];
    this.layers = layers;
    this.gDirt = new PIXI.Graphics();     // batched: redrawn each frame
    layers.groundFx.addChild(this.gDirt);
    this.gAir = new PIXI.Graphics();
    layers.fx.addChild(this.gAir);
    this.dirtThrottle = 0;
  }

  add(p) {
    if (this.pool.length >= MAX_PARTICLES) this.pool.shift();
    this.pool.push(p);
  }

  // ---- emitters -------------------------------------------------------------
  dirt(x, y, intensity = 1) {
    if (Math.random() > 0.35 * intensity) return;
    this.add({
      kind: 'dirt', x: x + (Math.random() - 0.5) * 8, y: y + 6 + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 10,
      r: 1.5 + Math.random() * 2.2 * intensity, life: 0.55, t: 0.55,
      color: PALETTE.dirt, alpha: 0.55, layer: 'ground', grav: 30,
    });
  }
  wake(x, y, dir) {
    if (Math.random() > 0.5) return;
    // expanding ripple ring + noisy spray behind the hull (visual spec §6)
    this.add({ kind: 'ring', x, y, r: 3, vr: 26, life: 0.8, t: 0.8, color: PALETTE.waterFoam, alpha: 0.4, layer: 'ground' });
    this.add({
      kind: 'dirt', x: x - Math.cos(dir) * 12, y: y - Math.sin(dir) * 12,
      vx: -Math.cos(dir) * 20 + (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 12,
      r: 1.2 + Math.random() * 1.8, life: 0.5, t: 0.5, color: PALETTE.waterFoam, alpha: 0.5, layer: 'ground', grav: 0,
    });
  }
  ripple(x, y) {
    this.add({ kind: 'ring', x, y, r: 2, vr: 40, life: 0.9, t: 0.9, color: PALETTE.waterFoam, alpha: 0.5, layer: 'ground' });
  }
  muzzle(x, y, angle, big = false) {
    const d = big ? 20 : 14;
    const mx = x + Math.cos(angle) * d, my = y + Math.sin(angle) * d;
    this.add({ kind: 'flash', x: mx, y: my, r: big ? 9 : 6, life: 0.09, t: 0.09, color: 0xffe08a, alpha: 1, layer: 'air' });
    for (let i = 0; i < (big ? 4 : 2); i++) {
      this.add({
        kind: 'dirt', x: mx, y: my,
        vx: Math.cos(angle) * (30 + Math.random() * 40) + (Math.random() - 0.5) * 20,
        vy: Math.sin(angle) * (30 + Math.random() * 40) + (Math.random() - 0.5) * 20,
        r: 1.5 + Math.random() * 2, life: 0.3, t: 0.3, color: 0xbcbcbc, alpha: 0.6, layer: 'air', grav: 0,
      });
    }
  }
  impact(x, y, dmgType, air = false) {
    const colors = { Kinetic: 0xffd28a, Fire: 0xff8844, Electric: 0x88e0ff, Frost: 0xbfe8ff, Poison: 0x9ee06a, Concussion: 0xffcf7a };
    const col = colors[dmgType] || 0xffd28a;
    if (air) { // flak puff
      this.add({ kind: 'puff', x, y, r: 5, vr: 26, life: 0.5, t: 0.5, color: 0x8a8a8a, alpha: 0.8, layer: 'air' });
      this.add({ kind: 'flash', x, y, r: 7, life: 0.08, t: 0.08, color: col, alpha: 1, layer: 'air' });
    } else {
      this.add({ kind: 'flash', x, y, r: 6, life: 0.08, t: 0.08, color: col, alpha: 1, layer: 'air' });
    }
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        kind: 'spark', x, y, vx: Math.cos(a) * (40 + Math.random() * 70), vy: Math.sin(a) * (40 + Math.random() * 70),
        r: 1.4, life: 0.28, t: 0.28, color: col, alpha: 1, layer: 'air', grav: 60,
      });
    }
  }
  explosion(x, y, big = false) {
    this.add({ kind: 'flash', x, y, r: big ? 26 : 15, life: 0.14, t: 0.14, color: 0xffcc66, alpha: 1, layer: 'air' });
    this.add({ kind: 'puff', x, y, r: 8, vr: big ? 60 : 36, life: 0.7, t: 0.7, color: 0x555555, alpha: 0.7, layer: 'air' });
    const n = big ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * (big ? 120 : 80);
      this.add({
        kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        r: 1.6 + Math.random() * 2.6, life: 0.8, t: 0.8,
        color: Math.random() > 0.5 ? 0x4f4f4f : PALETTE.dirt, alpha: 1, layer: 'air', grav: 140,
      });
    }
  }
  splash(x, y) {
    this.add({ kind: 'ring', x, y, r: 3, vr: 60, life: 0.7, t: 0.7, color: PALETTE.waterFoam, alpha: 0.8, layer: 'ground' });
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        kind: 'spark', x, y, vx: Math.cos(a) * 40, vy: -50 - Math.random() * 50,
        r: 1.8, life: 0.55, t: 0.55, color: PALETTE.waterFoam, alpha: 0.9, layer: 'air', grav: 220,
      });
    }
  }
  buildDust(x, y) {
    this.add({
      kind: 'puff', x: x + (Math.random() - 0.5) * 30, y: y + 14,
      r: 3 + Math.random() * 3, vr: 12, vy: -18 - Math.random() * 12,
      life: 0.8, t: 0.8, color: 0xc9b592, alpha: 0.5, layer: 'ground',
    });
  }
  smoke(x, y) {
    this.add({
      kind: 'puff', x, y, r: 3 + Math.random() * 2, vr: 7, vy: -22 - Math.random() * 8,
      vx: (Math.random() - 0.5) * 6, life: 1.3, t: 1.3, color: 0x333333, alpha: 0.45, layer: 'air',
    });
  }
  sellPuff(x, y) {
    for (let i = 0; i < 6; i++) {
      this.add({
        kind: 'puff', x: x + (Math.random() - 0.5) * 24, y: y + (Math.random() - 0.5) * 24,
        r: 4, vr: 16, life: 0.5, t: 0.5, color: 0xc9b592, alpha: 0.6, layer: 'ground',
      });
    }
  }

  update(dt) {
    const gG = this.gDirt, gA = this.gAir;
    gG.clear(); gA.clear();
    let w = 0;
    for (const p of this.pool) {
      p.t -= dt;
      if (p.t <= 0) continue;
      this.pool[w++] = p;
      const k = p.t / p.life;
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.grav) p.vy += p.grav * dt;
      if (p.vr) p.r += p.vr * dt;
      const g = p.layer === 'ground' ? gG : gA;
      switch (p.kind) {
        case 'ring':
          g.lineStyle(2, p.color, p.alpha * k);
          g.drawCircle(p.x, p.y, p.r);
          g.lineStyle(0);
          break;
        case 'flash':
          g.beginFill(p.color, p.alpha * k);
          g.drawCircle(p.x, p.y, p.r * (2 - k));
          g.endFill();
          break;
        default:
          g.beginFill(p.color, p.alpha * k);
          g.drawCircle(p.x, p.y, p.r);
          g.endFill();
      }
    }
    this.pool.length = w;
  }
}

// ---- one-shot animated FX that need their own display objects ---------------

export class FxManager {
  constructor(layers) {
    this.layers = layers;
    this.items = [];
  }

  /** universal gold “done + paid off” pie-sweep (visual spec §5) */
  pieSweep(x, y) {
    const g = new PIXI.Graphics();
    g.position.set(x, y);
    this.layers.fx.addChild(g);
    this.items.push({ kind: 'pie', g, t: 0, dur: 0.65 });
  }

  /** classic coin pop: arc up, bounce, “+N” label */
  coin(x, y, amount, worldRotGetter) {
    const c = new PIXI.Container();
    c.position.set(x, y);
    const coin = new PIXI.Graphics();
    coin.beginFill(0xc9992e); coin.drawCircle(0, 0, 6); coin.endFill();
    coin.beginFill(PALETTE.gold); coin.drawCircle(0, -0.8, 5); coin.endFill();
    coin.beginFill(0xc9992e); coin.drawRect(-1.2, -3.6, 2.4, 6); coin.endFill();
    const label = new PIXI.Text('+' + amount, {
      fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold',
      fill: 0xffe08a, stroke: 0x442200, strokeThickness: 3,
    });
    label.anchor.set(0.5, 1.6);
    c.addChild(coin, label);
    this.layers.fx.addChild(c);
    this.items.push({ kind: 'coin', g: c, coin, t: 0, dur: 1.05, vy: -60, worldRotGetter });
  }

  rubble(x, y) {
    const g = new PIXI.Graphics();
    g.beginFill(0x4a4a4a, 0.8);
    for (let i = 0; i < 7; i++) {
      g.drawCircle((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, 3 + Math.random() * 5);
    }
    g.endFill();
    g.beginFill(0x2e2e2e, 0.5);
    g.drawEllipse(0, 0, 20, 13);
    g.endFill();
    g.position.set(x, y);
    this.layers.grass.addChild(g); // decal under actors
    return g;
  }

  update(dt) {
    let w = 0;
    for (const it of this.items) {
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.g.destroy({ children: true }); continue; }
      this.items[w++] = it;
      if (it.kind === 'pie') {
        const g = it.g;
        g.clear();
        const ang = Math.min(1, k * 1.25) * Math.PI * 2;
        g.beginFill(PALETTE.gold, 0.55 * (1 - k * 0.6));
        g.moveTo(0, 0);
        g.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + ang);
        g.lineTo(0, 0);
        g.endFill();
        g.lineStyle(3, PALETTE.gold, 0.9 * (1 - k));
        g.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + ang);
        g.lineStyle(0);
      } else if (it.kind === 'coin') {
        it.vy += 190 * dt;
        it.g.y += it.vy * dt;
        if (it.vy > 0 && it.t > 0.55) it.vy *= -0.4; // little bounce
        it.coin.scale.x = Math.cos(it.t * 9);        // spin
        it.g.alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        if (it.worldRotGetter) it.g.rotation = -it.worldRotGetter();
      }
    }
    this.items.length = w;
  }
}

/** Tracer rendering straight from sim projectiles (redrawn every frame). */
export function drawProjectiles(g, sim, alpha) {
  g.clear();
  for (const p of sim.projectiles) {
    const x = p.x * TILE, y = p.y * TILE;
    const dx = x - p.sx * TILE, dy = y - p.sy * TILE;
    const len = Math.hypot(dx, dy) || 1;
    const tx = x - (dx / len) * 12, ty = y - (dy / len) * 12;
    const enemy = p.side === 'enemy';
    g.lineStyle(2.5, enemy ? 0xff9966 : 0xfff2b0, 0.55);
    g.moveTo(tx, ty); g.lineTo(x, y);
    g.lineStyle(0);
    g.beginFill(enemy ? 0xffbb66 : 0xffffff, 1);
    g.drawCircle(x, y, enemy ? 2.6 : 2.2);
    g.endFill();
  }
}
