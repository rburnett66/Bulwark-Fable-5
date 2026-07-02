// Structure views + full lifecycle FX (visual spec §5):
// placing ghost → construction dust → gold pie-sweep on completion → damage
// smoke → aiming/firing recoil → upgrade dust/flash → sell puff → debris+rubble.

/* global PIXI */
import { PALETTE, TOWERS } from '../sim/data.js';
import { TILE, SUN, drawDashedCircle } from './terrain.js';
import { angDelta } from './units.js';

export class StructureView {
  constructor(s, layers, particles) {
    this.id = s.id;
    this.kind = s.kind;
    this.particles = particles;
    this.layers = layers;
    this.recoil = 0;
    this.smokeT = 0;
    this.dustT = 0;
    this.tier = s.tier;

    this.root = new PIXI.Container();
    this.root.position.set(s.x * TILE, s.y * TILE);
    this.base = new PIXI.Graphics();
    this.weapon = new PIXI.Graphics();
    this.dish = new PIXI.Graphics();
    this.overlay = new PIXI.Graphics();   // scaffold / progress
    this.badge = new PIXI.Graphics();     // tier chevrons
    this.hpBar = new PIXI.Graphics();
    this.hpBar.y = -TILE * 0.62;
    this.root.addChild(this.base, this.weapon, this.dish, this.overlay, this.badge, this.hpBar);

    this.shadow = new PIXI.Graphics();
    this.shadow.beginFill(PALETTE.shadow, 0.3);
    this.shadow.drawEllipse(0, 0, 17, 10);
    this.shadow.endFill();
    this.shadow.position.set(s.x * TILE + SUN.x * 14, s.y * TILE + SUN.y * 14);
    layers.shadows.addChild(this.shadow);

    this.redraw(s.tier);
    this.root._anchorY = s.y * TILE + TILE * 0.4;
    layers.main.addChild(this.root);
  }

  redraw(tier) {
    const { base, weapon, dish } = this;
    base.clear(); weapon.clear(); dish.clear();
    const up = tier >= 1;
    const bodyC = PALETTE.playerBody, darkC = PALETTE.playerDark, accC = PALETTE.playerAccent;

    if (this.kind === 'cannon') {
      base.beginFill(0x4d4d55); base.drawCircle(0, 0, 16); base.endFill();
      base.beginFill(0x64646e); base.drawCircle(0, 0, 12.5); base.endFill();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        base.beginFill(0x3a3a42); base.drawCircle(Math.cos(a) * 14, Math.sin(a) * 14, 1.8); base.endFill();
      }
      base.beginFill(bodyC); base.drawCircle(0, 0, up ? 10 : 8.5); base.endFill();
      weapon.beginFill(darkC); weapon.drawRect(0, -3, up ? 22 : 18, 6); weapon.endFill();
      weapon.beginFill(0x222222); weapon.drawRect(up ? 18 : 14, -4, 5, 8); weapon.endFill();
      if (up) { weapon.beginFill(accC); weapon.drawRect(4, -3, 3, 6); weapon.endFill(); }
      dish.beginFill(accC, 0.9); dish.drawCircle(0, 0, 2.5); dish.endFill();
    } else if (this.kind === 'flak') {
      base.beginFill(0x4d4d55); base.drawRoundedRect(-15, -15, 30, 30, 5); base.endFill();
      base.beginFill(0x64646e); base.drawRoundedRect(-11, -11, 22, 22, 4); base.endFill();
      base.beginFill(bodyC); base.drawCircle(0, 0, up ? 9.5 : 8); base.endFill();
      // twin AA barrels
      weapon.beginFill(darkC);
      weapon.drawRect(0, -5, up ? 19 : 15, 3.4);
      weapon.drawRect(0, 1.6, up ? 19 : 15, 3.4);
      weapon.endFill();
      weapon.beginFill(0x222222); weapon.drawRect(up ? 15 : 11, -6, 4, 12); weapon.endFill();
      // spinning radar dish (radar sees air)
      dish.beginFill(0xd8e6ee); dish.drawPolygon([0, 0, 10, -4, 10, 4]); dish.endFill();
      dish.beginFill(accC); dish.drawCircle(0, 0, 2.6); dish.endFill();
      dish.y = -10;
    } else { // wall / moat
      base.beginFill(0x7b7f86); base.drawRoundedRect(-19, -19, 38, 38, 4); base.endFill();
      base.beginFill(0x969aa2); base.drawRoundedRect(-19, -19, 38, 30, 4); base.endFill();
      // crenellation
      base.beginFill(0x6a6e75);
      for (const [gx, gy] of [[-13, -13], [0, -13], [13, -13], [-13, 0], [13, 0], [-13, 12], [0, 12], [13, 12]]) {
        base.drawRect(gx - 4, gy - 4, 8, 8);
      }
      base.endFill();
      if (up) { base.beginFill(accC, 0.5); base.drawRect(-19, -20, 38, 3); base.endFill(); }
    }

    // tier chevrons
    this.badge.clear();
    if (tier >= 1) {
      this.badge.beginFill(PALETTE.gold);
      this.badge.drawPolygon([-20, 14, -15, 14, -17.5, 10]);
      this.badge.endFill();
    }
    this.tier = tier;
  }

  /** s = live sim structure; o = {hp01, buildProgress, worldRot} */
  update(s, o, dtSec, tSec) {
    // aim & fire recoil
    if (s.def.canTarget && s.state === 'ready') {
      this.weapon.rotation += angDelta(this.weapon.rotation, s.aim) * Math.min(1, dtSec * 9);
      if (this.kind === 'flak') this.dish.rotation = tSec * 2.2;   // radar sweep
      if (this.recoil > 0) {
        this.recoil -= dtSec * 5;
        const k = Math.max(0, this.recoil);
        this.weapon.position.set(-Math.cos(this.weapon.rotation) * k * 3.5, -Math.sin(this.weapon.rotation) * k * 3.5);
      } else this.weapon.position.set(0, 0);
    }

    // construction / upgrade overlay: scaffold + rising dust + progress bar
    this.overlay.clear();
    if (s.state === 'building' || s.state === 'upgrading') {
      const p = o.buildProgress;
      this.overlay.lineStyle(2, 0xb08b4f, 0.9);
      this.overlay.drawRect(-17, -17, 34, 34);
      this.overlay.moveTo(-17, -17); this.overlay.lineTo(17, 17);
      this.overlay.moveTo(17, -17); this.overlay.lineTo(-17, 17);
      this.overlay.lineStyle(0);
      this.overlay.beginFill(0x000000, 0.5); this.overlay.drawRect(-15, 20, 30, 4); this.overlay.endFill();
      this.overlay.beginFill(PALETTE.gold); this.overlay.drawRect(-14, 20.8, 28 * p, 2.4); this.overlay.endFill();
      this.overlay.rotation = -(o.worldRot || 0);
      this.dustT -= dtSec;
      if (this.dustT <= 0) { this.dustT = 0.09; this.particles.buildDust(s.x * TILE, s.y * TILE); }
      this.base.alpha = 0.75;
      this.weapon.visible = false;
    } else {
      this.base.alpha = 1;
      this.weapon.visible = true;
    }

    // damage smoke scaling with damage taken
    if (o.hp01 < 0.55 && s.state !== 'building') {
      this.smokeT -= dtSec;
      if (this.smokeT <= 0) {
        this.smokeT = 0.16 + o.hp01 * 0.5;
        this.particles.smoke(s.x * TILE + (Math.random() - 0.5) * 14, s.y * TILE + (Math.random() - 0.5) * 14);
      }
    }

    // hp bar
    this.hpBar.clear();
    if (o.hp01 < 0.999) {
      this.hpBar.beginFill(0x000000, 0.55); this.hpBar.drawRect(-15, 0, 30, 4); this.hpBar.endFill();
      this.hpBar.beginFill(o.hp01 > 0.4 ? PALETTE.hp : PALETTE.damage);
      this.hpBar.drawRect(-14.4, 0.7, 28.8 * o.hp01, 2.6);
      this.hpBar.endFill();
      this.hpBar.rotation = -(o.worldRot || 0);
    }

    this.root.zIndex = o.sortY;
  }

  onShot() { this.recoil = 1; }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
  }
}

/** Placement ghost + selection ring live outside the per-structure views. */
export class PlacementUI {
  constructor(layers) {
    this.ghost = new PIXI.Container();
    this.ghostG = new PIXI.Graphics();
    this.rangeG = new PIXI.Graphics();
    this.ghost.addChild(this.rangeG, this.ghostG);
    this.ghost.visible = false;
    layers.fx.addChild(this.ghost);

    this.select = new PIXI.Graphics();
    layers.groundFx.addChild(this.select);
    this.selectPulse = 0;
  }

  showGhost(kind, c, r, valid) {
    const def = TOWERS[kind];
    this.ghost.visible = true;
    this.ghost.position.set((c + 0.5) * TILE, (r + 0.5) * TILE);
    const g = this.ghostG;
    g.clear();
    const col = valid ? 0x66ff88 : 0xff5544;
    g.beginFill(col, 0.35);
    g.drawRoundedRect(-TILE / 2 + 3, -TILE / 2 + 3, TILE - 6, TILE - 6, 6);
    g.endFill();
    g.lineStyle(2, col, 0.9);
    g.drawRoundedRect(-TILE / 2 + 3, -TILE / 2 + 3, TILE - 6, TILE - 6, 6);
    const rg = this.rangeG;
    rg.clear();
    if (def.range > 0) {
      rg.beginFill(col, 0.07);
      rg.drawCircle(0, 0, def.range * TILE);
      rg.endFill();
      drawDashedCircle(rg, 0, 0, def.range * TILE, col, 0.5);
    }
    if (def.radar) drawDashedCircle(rg, 0, 0, def.radar * TILE, 0x3fd0ff, 0.35);
  }
  hideGhost() { this.ghost.visible = false; }

  /** dashed range circle around the selected structure (visual spec §5) */
  showSelection(s, dtSec) {
    this.selectPulse += dtSec;
    const g = this.select;
    g.clear();
    if (!s) return;
    const x = s.x * TILE, y = s.y * TILE;
    const pulse = 1 + Math.sin(this.selectPulse * 4) * 0.02;
    if (s.def.range > 0) drawDashedCircle(g, x, y, s.def.range * TILE * pulse, 0xffffff, 0.55);
    if (s.def.radar) drawDashedCircle(g, x, y, s.def.radar * TILE, 0x3fd0ff, 0.3);
    g.lineStyle(2, PALETTE.gold, 0.9);
    g.drawRoundedRect(x - TILE / 2 + 2, y - TILE / 2 + 2, TILE - 4, TILE - 4, 6);
  }
}
