// Static world: ground bands, water lane (shader), trees with cast shadows,
// grass/bush doodads, base fort, clouds (shader quads + their ground shadows).
// Layer order follows the canonical z-order (visual spec §1).

/* global PIXI */
import { GRID_W, GRID_H, SLICE_LAYOUT } from '../sim/map.js';
import { PALETTE, SLICE } from '../sim/data.js';
import { makeWaterFilter, makeCloudFilter } from './shaders.js';

export const TILE = 48;
export const SUN = { x: 0.42, y: 0.55 };  // fixed world-space sun offset (shadows fall SE)

// deterministic decorative scatter (visual only, but stable frame to frame)
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export function buildTerrain(layers, layout = SLICE_LAYOUT) {
  const rnd = lcg(1234567);
  const BASE = layout.base;
  const TREES = layout.trees;
  const wset = new Set(layout.water);
  const isWater = (c, r) => wset.has(r * GRID_W + c);
  const waterCells = layout.water.map(k => [k % GRID_W, (k - (k % GRID_W)) / GRID_W]);

  // ---- ground: low/mid/high bands + mottling -------------------------------
  const g = new PIXI.Graphics();
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      if (isWater(c, r)) continue;
      const band = r < layout.bands.high ? PALETTE.groundHigh : (r < layout.bands.mid ? PALETTE.groundMid : PALETTE.groundLow);
      g.beginFill(band);
      g.drawRect(c * TILE, r * TILE, TILE, TILE);
      g.endFill();
    }
  }
  // mottled patches + worn dirt near the base clearing
  for (let i = 0; i < 260; i++) {
    const c = rnd() * GRID_W, r = rnd() * GRID_H;
    if (isWater(Math.floor(c), Math.floor(r))) continue;
    const dark = rnd() > 0.5;
    g.beginFill(dark ? 0x000000 : 0xffffff, dark ? 0.05 : 0.04);
    g.drawEllipse(c * TILE, r * TILE, 8 + rnd() * 22, 6 + rnd() * 14);
    g.endFill();
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * 2.6 * TILE;
    g.beginFill(PALETTE.dirt, 0.16);
    g.drawEllipse(BASE.cx * TILE + Math.cos(a) * d, BASE.cy * TILE + Math.sin(a) * d * 0.7, 10 + rnd() * 18, 7 + rnd() * 10);
    g.endFill();
  }
  // dirt banks hugging the shoreline, whatever shape the river takes
  g.beginFill(PALETTE.dirt, 0.5);
  for (const [c, r] of waterCells) {
    if (!isWater(c, r - 1)) g.drawRect(c * TILE, r * TILE - 3, TILE, 3);
    if (!isWater(c, r + 1)) g.drawRect(c * TILE, (r + 1) * TILE, TILE, 3);
    if (!isWater(c - 1, r)) g.drawRect(c * TILE - 3, r * TILE, 3, TILE);
    if (!isWater(c + 1, r)) g.drawRect((c + 1) * TILE, r * TILE, 3, TILE);
  }
  g.endFill();
  layers.ground.addChild(g);

  // ---- water with animated shader -------------------------------------------
  // shore cells fill shallow, fully-surrounded cells fill deep; the shader
  // adds waves and probes the alpha edge for shoreline foam.
  // cells drawn overlapping so no anti-aliased seams appear inside the mask
  // (the shader's foam probe would read seams as shoreline)
  const water = new PIXI.Graphics();
  water.beginFill(PALETTE.waterShallow);
  for (const [c, r] of waterCells) water.drawRect(c * TILE - 1, r * TILE - 1, TILE + 2, TILE + 2);
  water.endFill();
  water.beginFill(PALETTE.waterDeep);
  for (const [c, r] of waterCells) {
    if (isWater(c + 1, r) && isWater(c - 1, r) && isWater(c, r + 1) && isWater(c, r - 1)) {
      water.drawRect(c * TILE - 6, r * TILE - 6, TILE + 12, TILE + 12);
    }
  }
  water.endFill();
  const waterFilter = makeWaterFilter(PALETTE);
  water.filters = [waterFilter];
  layers.water.addChild(water);

  // ---- grass & bushes -------------------------------------------------------
  const grass = new PIXI.Graphics();
  for (let i = 0; i < 220; i++) {
    const c = rnd() * GRID_W, r = rnd() * GRID_H;
    if (isWater(Math.floor(c), Math.floor(r))) continue;
    grass.beginFill(PALETTE.grass, 0.8);
    const x = c * TILE, y = r * TILE;
    grass.drawPolygon([x, y, x + 2, y - 6 - rnd() * 5, x + 4, y]);
    grass.endFill();
  }
  for (let i = 0; i < 26; i++) {
    const c = rnd() * GRID_W, r = rnd() * GRID_H;
    if (isWater(Math.floor(c), Math.floor(r)) || (Math.abs(c - BASE.cx) < 3 && Math.abs(r - BASE.cy) < 3)) continue;
    grass.beginFill(PALETTE.bush);
    grass.drawEllipse(c * TILE, r * TILE, 9 + rnd() * 7, 7 + rnd() * 5);
    grass.endFill();
    grass.beginFill(0xffffff, 0.07);
    grass.drawEllipse(c * TILE - 3, r * TILE - 3, 5, 3);
    grass.endFill();
  }
  layers.grass.addChild(grass);

  // ---- trees (occluders, sorted with units; canopies sway) -----------------
  const trees = [];
  for (const [c, r] of TREES) {
    const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
    // cast shadow on the terrain shadow layer
    const sh = new PIXI.Graphics();
    sh.beginFill(PALETTE.shadow, 0.28);
    sh.drawEllipse(0, 0, 22, 12);
    sh.endFill();
    sh.position.set(x + SUN.x * 34, y + SUN.y * 34);
    layers.shadows.addChild(sh);

    const tree = new PIXI.Container();
    tree.position.set(x, y);
    const trunk = new PIXI.Graphics();
    trunk.beginFill(PALETTE.treeTrunk);
    trunk.drawRect(-3, -6, 6, 12);
    trunk.endFill();
    const canopy = new PIXI.Graphics();
    canopy.beginFill(PALETTE.treeCanopy);
    canopy.drawCircle(0, 0, 16);
    canopy.drawCircle(-10, 5, 11);
    canopy.drawCircle(10, 4, 12);
    canopy.endFill();
    canopy.beginFill(0xffffff, 0.08);
    canopy.drawCircle(-5, -6, 8);
    canopy.endFill();
    canopy.y = -14;
    tree.addChild(trunk, canopy);
    tree._anchorY = y;
    tree._canopy = canopy;
    tree._phase = rnd() * Math.PI * 2;
    layers.main.addChild(tree);
    trees.push(tree);
  }

  // ---- the base fort (in the clearing) --------------------------------------
  const base = new PIXI.Container();
  const bx = BASE.c0 * TILE, by = BASE.r0 * TILE, bw = 2 * TILE, bh = 2 * TILE;
  const bsh = new PIXI.Graphics();
  bsh.beginFill(PALETTE.shadow, 0.3);
  bsh.drawEllipse(bx + bw / 2 + SUN.x * 40, by + bh / 2 + SUN.y * 40, bw * 0.62, bh * 0.4);
  bsh.endFill();
  layers.shadows.addChild(bsh);

  const bg = new PIXI.Graphics();
  bg.beginFill(0x8d8577); bg.drawRoundedRect(bx + 4, by + 4, bw - 8, bh - 8, 8); bg.endFill();
  bg.beginFill(0x6e675c); bg.drawRoundedRect(bx + 10, by + 10, bw - 20, bh - 20, 6); bg.endFill();
  // corner towers
  for (const [tx, ty] of [[bx + 8, by + 8], [bx + bw - 8, by + 8], [bx + 8, by + bh - 8], [bx + bw - 8, by + bh - 8]]) {
    bg.beginFill(0x9d9485); bg.drawCircle(tx, ty, 9); bg.endFill();
    bg.beginFill(0x77705f); bg.drawCircle(tx, ty, 5); bg.endFill();
  }
  // keep + banner
  bg.beginFill(PALETTE.playerBody); bg.drawRect(bx + bw / 2 - 10, by + bh / 2 - 14, 20, 22); bg.endFill();
  bg.beginFill(PALETTE.playerAccent); bg.drawPolygon([bx + bw / 2, by + bh / 2 - 30, bx + bw / 2 + 14, by + bh / 2 - 25, bx + bw / 2, by + bh / 2 - 20]); bg.endFill();
  bg.lineStyle(2, PALETTE.playerAccent, 0.5);
  bg.drawRect(bx + bw / 2 - 1, by + bh / 2 - 30, 1, 16);
  base.addChild(bg);
  base._anchorY = by + bh - 6;
  layers.main.addChild(base);

  // ---- radar dome ring (base radar sees air — GDD §5) -----------------------
  const radar = new PIXI.Graphics();
  drawDashedCircle(radar, BASE.cx * TILE, BASE.cy * TILE, SLICE.baseRadar * TILE, 0x3fd0ff, 0.10);
  layers.groundFx.addChild(radar);

  // ---- clouds: drifting shader quads + their dim ground shadows -------------
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const w = 260 + i * 90, h = 150 + i * 30;
    const quad = new PIXI.Graphics();
    quad.beginFill(0xffffff, 1);
    quad.drawRect(0, 0, w, h);
    quad.endFill();
    const filt = makeCloudFilter(i * 17.31 + 3, 1.5 + i * 0.15);
    quad.filters = [filt];
    quad.pivot.set(w / 2, h / 2);
    quad.alpha = 0.8;
    const holder = new PIXI.Container();
    holder.addChild(quad);
    layers.clouds.addChild(holder);

    const csh = new PIXI.Graphics();
    csh.beginFill(PALETTE.shadow, 0.10);
    csh.drawEllipse(0, 0, w * 0.42, h * 0.34);
    csh.endFill();
    layers.shadows.addChild(csh);

    clouds.push({
      holder, filt, shadow: csh,
      x: rnd() * GRID_W * TILE, y: rnd() * GRID_H * TILE,
      vx: 6 + rnd() * 7, // px/sec eastward drift
    });
  }

  return {
    waterFilter, trees, clouds,
    update(dt, tSec) {
      waterFilter.uniforms.uTime = tSec;
      for (const tr of trees) { // canopy sway — vertex-level motion on the cheap
        tr._canopy.rotation = Math.sin(tSec * 1.1 + tr._phase) * 0.045;
        tr._canopy.skew.x = Math.sin(tSec * 0.7 + tr._phase) * 0.03;
      }
      for (const cl of clouds) {
        cl.filt.uniforms.uTime = tSec;
        cl.x += cl.vx * dt;
        const wrap = GRID_W * TILE + 300;
        if (cl.x > wrap) cl.x -= wrap + 200;
        cl.holder.position.set(cl.x, cl.y);
        cl.shadow.position.set(cl.x + SUN.x * 130, cl.y + SUN.y * 130);
      }
    },
  };
}

export function drawDashedCircle(g, cx, cy, radius, color, alpha = 0.6, dash = 10, gap = 8, width = 2) {
  g.lineStyle(width, color, alpha);
  const circ = Math.PI * 2 * radius;
  const steps = Math.floor(circ / (dash + gap));
  for (let i = 0; i < steps; i++) {
    const a0 = (i * (dash + gap)) / radius;
    const a1 = a0 + dash / radius;
    g.moveTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius);
    g.arc(cx, cy, radius, a0, a1);
  }
  g.lineStyle(0);
}
