// Unit views — the four-sublayer “fake 3D” stack (visual spec §2):
// legs/locomotion → body → weapon (rotates to target, recoils) → head/sensors
// (leads the target during lock-on). Plus blob shadows, altitude shadows for
// flyers, dirt kick-up and water wakes.

/* global PIXI */
import { PALETTE } from '../sim/data.js';
import { TILE, SUN } from './terrain.js';

export class UnitView {
  constructor(u, layers, particles) {
    this.id = u.id;
    this.domain = u.domain;
    this.shape = u.shape;
    this.side = u.side;
    this.particles = particles;
    this.walkPhase = 0;
    this.recoil = 0;
    this.dead = false;

    this.root = new PIXI.Container();
    this.legs = new PIXI.Graphics();
    this.body = new PIXI.Graphics();
    this.weapon = new PIXI.Graphics();
    this.head = new PIXI.Graphics();
    this.hpBar = new PIXI.Graphics();
    this.hpBar.y = -26;
    this.lockRing = new PIXI.Graphics();
    this.root.addChild(this.legs, this.body, this.weapon, this.head, this.lockRing, this.hpBar);

    this.shadow = new PIXI.Graphics();
    layers.shadows.addChild(this.shadow);

    this.draw(u);
    (u.domain === 'Flyer' ? layers.air : layers.main).addChild(this.root);
    this.layers = layers;
  }

  draw(u) {
    const enemy = u.side === 'enemy';
    const bodyC = enemy ? PALETTE.enemyBody : PALETTE.playerBody;
    const accC = enemy ? PALETTE.enemyAccent : PALETTE.playerAccent;
    const darkC = enemy ? PALETTE.enemyDark : PALETTE.playerDark;
    const { legs, body, weapon, head, shadow } = this;

    if (u.kind === 'crew') {
      shadow.beginFill(PALETTE.shadow, 0.3); shadow.drawEllipse(0, 0, 7, 4); shadow.endFill();
      legs.beginFill(darkC); legs.drawEllipse(-3, 6, 3, 2); legs.drawEllipse(3, 6, 3, 2); legs.endFill();
      body.beginFill(bodyC); body.drawCircle(0, 0, 6); body.endFill();
      body.beginFill(accC); body.drawRect(-6, -2, 12, 3); body.endFill();     // toolbelt
      weapon.beginFill(0xcccccc); weapon.drawRect(2, -1.5, 9, 3); weapon.endFill(); // wrench
      head.beginFill(0xffd28a); head.drawCircle(0, 0, 4); head.endFill();
      head.beginFill(accC); head.drawCircle(0, -2, 3.4); head.endFill();      // hardhat
      return;
    }

    switch (u.shape) {
      case 'Troops': {
        shadow.beginFill(PALETTE.shadow, 0.3); shadow.drawEllipse(0, 0, 8, 4.5); shadow.endFill();
        legs.beginFill(darkC); legs.drawEllipse(-3.5, 7, 3, 2); legs.drawEllipse(3.5, 7, 3, 2); legs.endFill();
        body.beginFill(bodyC); body.drawCircle(0, 0, 6.5); body.endFill();
        body.beginFill(darkC); body.drawRect(-7, -2, 4, 5); body.endFill();   // pack
        weapon.beginFill(0x3a3a3a); weapon.drawRect(0, -1.5, 13, 3); weapon.endFill();
        weapon.beginFill(0x222222); weapon.drawRect(10, -2.2, 3, 4.4); weapon.endFill();
        head.beginFill(accC); head.drawCircle(0, 0, 4.5); head.endFill();
        head.beginFill(0x222222); head.drawRect(2.5, -1, 4, 2); head.endFill(); // visor
        break;
      }
      case 'Trucks': {
        shadow.beginFill(PALETTE.shadow, 0.32); shadow.drawEllipse(0, 0, 14, 7); shadow.endFill();
        // amphibious hull
        legs.beginFill(darkC); legs.drawRoundedRect(-15, -8, 30, 16, 5); legs.endFill();
        legs.beginFill(0x222222);
        for (const wx of [-10, -2, 7]) { legs.drawEllipse(wx, -8.5, 4, 2); legs.drawEllipse(wx, 8.5, 4, 2); }
        legs.endFill();
        body.beginFill(bodyC); body.drawRoundedRect(-13, -6, 26, 12, 4); body.endFill();
        body.beginFill(accC); body.drawRect(4, -6, 4, 12); body.endFill();    // stripe
        body.beginFill(darkC); body.drawRoundedRect(6, -5, 7, 10, 2); body.endFill(); // cab
        weapon.beginFill(0x3a3a3a); weapon.drawRect(0, -1.5, 12, 3); weapon.endFill();
        head.beginFill(0x9adcff, 0.9); head.drawCircle(0, 0, 3.4); head.endFill(); // sensor dome
        head.beginFill(0x222222); head.drawRect(2, -0.8, 3.5, 1.6); head.endFill();
        break;
      }
      case 'Copters': {
        shadow.beginFill(PALETTE.shadow, 1); shadow.drawEllipse(0, 0, 11, 6); shadow.endFill();
        // rotor layer replaces legs (visual spec §2.2)
        legs.beginFill(0x333333, 0.55); legs.drawEllipse(0, 0, 19, 4); legs.endFill();
        legs.beginFill(0x555555); legs.drawCircle(0, 0, 2.6); legs.endFill();
        body.beginFill(bodyC); body.drawEllipse(0, 0, 12, 6.5); body.endFill();
        body.beginFill(darkC); body.drawEllipse(-11, 0, 6, 2.5); body.endFill(); // tail
        body.beginFill(accC); body.drawEllipse(5, 0, 4.5, 3.5); body.endFill();  // canopy
        weapon.beginFill(0x3a3a3a); weapon.drawRect(2, -1.5, 12, 3); weapon.endFill();
        head.beginFill(0xffe08a, 0.95); head.drawCircle(0, 0, 3); head.endFill();
        head.beginFill(0x222222); head.drawRect(2, -0.8, 3.5, 1.6); head.endFill();
        break;
      }
      default: { // Tanks / Artillery / Heavy Tanks / Planes / Missiles (harness extras)
        shadow.beginFill(PALETTE.shadow, 0.32); shadow.drawEllipse(0, 0, 13, 7); shadow.endFill();
        legs.beginFill(0x2f2f2f); legs.drawRoundedRect(-14, -9, 28, 18, 4); legs.endFill();
        body.beginFill(bodyC); body.drawRoundedRect(-11, -7, 22, 14, 3); body.endFill();
        weapon.beginFill(0x3a3a3a); weapon.drawRect(0, -2, 18, 4); weapon.endFill();
        head.beginFill(accC); head.drawCircle(0, 0, 5); head.endFill();
        break;
      }
    }
  }

  /** o = interpolated {x, y (px), aim, headAim, moving, lock01, hp01, alt} */
  update(o, dtSec, tSec) {
    const r = this.root;
    r.position.set(o.x, o.y);

    // altitude: lift the sprite screen-up (counter-rotate the world spin)
    if (this.domain === 'Flyer' && !o.grounded) {
      const bob = Math.sin(tSec * 3 + this.id) * 2.5;
      const A = o.alt * TILE * 0.55 + bob;
      const th = o.worldRot || 0;
      r.position.set(o.x - Math.sin(th) * A, o.y - Math.cos(th) * A);
      // dim altitude shadow, farther offset when higher (visual spec §3)
      this.shadow.position.set(o.x + SUN.x * (26 + o.alt * 26), o.y + SUN.y * (26 + o.alt * 26));
      this.shadow.alpha = 0.16;
      this.shadow.scale.set(0.85);
      // rotor spin
      this.legs.rotation += dtSec * 26;
    } else {
      this.shadow.position.set(o.x + SUN.x * 10, o.y + SUN.y * 10);
      this.shadow.alpha = 1;
    }

    // legs cycle while moving; dirt / wake kick-up
    if (o.moving && this.domain !== 'Flyer') {
      this.walkPhase += dtSec * (this.shape === 'Troops' || this.shape === 'Crew' ? 11 : 6);
      const s = Math.sin(this.walkPhase);
      if (this.shape === 'Troops' || this.shape === 'Crew') {
        this.legs.position.set(0, 0);
        this.legs.scale.set(1, 1 + s * 0.18);
        this.body.y = Math.abs(s) * -1.2;
      } else {
        this.legs.y = s * 0.7;
      }
      if (this.domain === 'Walker') this.particles.dirt(o.x, o.y, this.shape === 'Troops' ? 0.4 : 1);
      else this.particles.wake(o.x, o.y, o.aim);
    } else {
      this.body.y = 0;
    }

    // body faces travel; weapon & head steer independently (telegraph)
    const facing = o.moving ? o.aim : this.body.rotation;
    this.body.rotation += angDelta(this.body.rotation, facing) * Math.min(1, dtSec * 6);
    this.legs.rotation = this.domain === 'Flyer' ? this.legs.rotation : this.body.rotation;
    this.head.rotation += angDelta(this.head.rotation, o.headAim) * Math.min(1, dtSec * 14); // sensors lead
    this.weapon.rotation += angDelta(this.weapon.rotation, o.aim) * Math.min(1, dtSec * 8);  // weapon follows

    // lock-on wind-up ring (players read time-to-fire from this)
    this.lockRing.clear();
    if (o.lock01 > 0 && o.lock01 < 1) {
      this.lockRing.lineStyle(1.5, 0xffcc33, 0.9);
      this.lockRing.arc(0, 0, 13, -Math.PI / 2, -Math.PI / 2 + o.lock01 * Math.PI * 2);
    }

    // recoil
    if (this.recoil > 0) {
      this.recoil -= dtSec * 6;
      const k = Math.max(0, this.recoil);
      this.weapon.position.set(-Math.cos(this.weapon.rotation) * k * 4, -Math.sin(this.weapon.rotation) * k * 4);
    } else {
      this.weapon.position.set(0, 0);
    }

    // hp bar (only when hurt)
    this.hpBar.clear();
    if (o.hp01 < 0.999) {
      this.hpBar.beginFill(0x000000, 0.55); this.hpBar.drawRect(-11, 0, 22, 3.5); this.hpBar.endFill();
      this.hpBar.beginFill(o.hp01 > 0.4 ? PALETTE.hp : PALETTE.damage);
      this.hpBar.drawRect(-10.5, 0.6, 21 * o.hp01, 2.3); this.hpBar.endFill();
      this.hpBar.rotation = -(o.worldRot || 0); // keep readable while world spins
    }

    // depth sort among ground actors
    if (this.domain !== 'Flyer') r.zIndex = o.sortY;
  }

  onShot() { this.recoil = 1; }

  destroy() {
    this.root.destroy({ children: true });
    this.shadow.destroy();
    this.dead = true;
  }
}

export function angDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
