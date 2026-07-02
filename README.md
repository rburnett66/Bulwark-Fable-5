# BULWARK — Vertical Slice

A multi-faction, multi-domain tower defense built to the BULWARK GDD §19 benchmark spec:
one ground lane beside one water lane, ending at your outpost in a clearing. Walkers march,
floaters swim, flyers ignore the terrain — and everything runs on a deterministic,
headless-callable sim core rendered with PixiJS (layered fake-3D, real shaders).

## Run it

```bash
npm start          # zero-dependency static server → http://localhost:8000
```

(or any static server from the repo root, e.g. `python3 -m http.server 8000`).
No build step, no network needed — PixiJS 7.4.3 is vendored in `vendor/`.

```bash
npm run headless   # proof: same seed twice → identical hash; different seed → diverges
npm run balance    # GDD §17 harness: price table from 100 seeded runs per unit
npm run mapcheck   # audit random map generation: validity, determinism, sim stability
node headless/balance.js --all        # price the full 72-unit roster
node headless/balance.js --runs 40    # faster pass
```

## How to play

- **Survive 5 waves** of the Ground/Powder assault. Base HP 2000, starting gold 800
  (locked slice parameters from `bulwark-balance.xlsx` → Vertical_Slice).
- **Every game gets a random map**, generated from the game seed within the slice
  geometry contract (one ground lane beside one water lane, base in a clearing).
  Water is carved **organically**: a meandering river walks west→east with
  breathing width (2–3 tiles), sometimes budding a pond; the outpost claims a
  shoreline clearing in the east on either bank, and spawn corridors, tree
  stands, and elevation bands vary with it. Each candidate board passes a quick
  pathing verification before play — walker A* routes from every spawn row (with
  a minimum march length), a floater route down the river into strike range of
  the base, and enough buildable ground — otherwise it re-rolls deterministically
  (fixed board as final fallback). Same seed → same map, so replays reconstruct
  the board for free; the intro "Recon" toast describes what was generated.
- New to the game? Read **`docs/GAME_GUIDE.md`** — full feature tour, controls,
  enemy/tower tables, and tactics.
- **Build** (keys 1/2/3 or the bottom bar): Cannon Tower (anti-ground), Flak Tower
  (anti-air, needs radar contact), Wall/Moat (reroutes walkers — you can maze, but
  never fully seal the lane). Hover shows a valid/invalid ghost; click to place
  (shift-click to keep placing); right-click/Esc cancels.
- **Click a structure** for its context menu: Upgrade (one tier in the slice),
  Repair (free — but the crew costs 20g and has to march out from the base), Sell
  (50% refund). The dashed circle is its range; cyan is radar.
- **Economy is real-time**: kills pay 35% of unit cost, wave clears pay a bounty,
  and you can absolutely go broke.
- **Camera**: Q/E or ⟲⟳ to rotate (watch the layer parallax and shadows hold up),
  +/− to zoom. Space or the button sends the next wave early. Esc pauses.
- **Watch out at wave 4+**: raider copters are flagged to attack your towers.
  Everything else beelines for the base and ignores structures (GDD §6 rule).

## Menu system

- **Play** — optional seed input (same seed + same actions = identical battle).
- **Replays** — every battle silently records a log (seed + tick-stamped commands).
  Replays re-drive the same sim from that log; the final state hash is compared and
  shown (“✓ deterministic — replay hash matches”). This is GDD §18/§19 determinism
  made visible (visual spec §9).
- **Settings** — master / effects / ambience volume, persisted to localStorage.
  All SFX are synthesized WebAudio (the coin pickup is a proper console-classic
  two-tone arpeggio).

## Architecture (GDD §18)

```
src/sim/        deterministic core — pure JS, zero DOM/Pixi imports
  data.js         all tunables transcribed from bulwark-balance.xlsx
  units_data.js   AUTO-GENERATED full 72-unit roster (tools/extract_balance.py)
  map.js          seeded random map generation + pathing validation, fixed
                  slice board, A* pathfinding, seal-check
  sim.js          fixed-step 30 Hz sim: waves, combat, economy, lifecycle, hash
  replay.js       battle log finalize/verify + localStorage persistence
src/render/     PixiJS presentation (reads sim state, never mutates it)
  shaders.js      water + cloud fragment shaders
  terrain.js      layered board, trees, clouds, base, sun/shadows
  units.js        4-sublayer unit stacks (legs/body/weapon/head)
  structures.js   tower views + lifecycle FX, placement ghost, selection
  fx.js           particles, three-part shots, pie-sweep, coins
  renderer.js     world layers, camera, depth sort, event→FX dispatch
src/ui/hud.js   DOM HUD (screen-space; never rotates)
src/game.js     session glue: 30 Hz sim steps + interpolated 60 fps render
src/main.js     menu shell (play / replays / settings)
headless/       run.js (determinism proof) · balance.js (§17) · serve.js
```

- **Sim/render separation**: the renderer holds no game state; it mirrors
  `sim.units/structures/projectiles` per frame and consumes a typed event stream
  (`shot`, `impact`, `death`, `coin`, `buildDone`, …) for FX and audio. The same
  `Sim` class runs in Node with no browser at all.
- **Determinism**: one seeded mulberry32 stream, fixed-order updates, tick-stamped
  commands, no `Math.random`/`Date.now` inside the sim. A rolling FNV-1a hash over
  (tick, gold, baseHP, entities) fingerprints the battle; replays and re-runs must
  reproduce it exactly. `npm run headless` asserts this.
- **Data-driven**: units, towers, damage-type × armor-class effectiveness (6×5),
  status effects, faction counter graph, waves, story beats, palette — all tables
  in `src/sim/data.js` / `units_data.js`, regenerable from the workbook.

## Balance sim (GDD §17)

The harness and the scripted headless demo always run on the **fixed benchmark
board** (`SLICE_LAYOUT`) so §17 price tables stay comparable across builds;
random maps are an interactive-play feature. `headless/mapcheck.js` audits the
generator: 500 seeds → 500 valid boards, byte-identical on regeneration, with
battle hashes reproduced on generated maps.

`headless/balance.js` builds the fixed, documented defense set
(cannons @14,6 & 18,8 · flak @16,6 · walls @12,5-7) on the same board the slice
plays on, streams each unit at it across **100 seeded runs**, and prices the unit
by **average effective DPS** (damage actually delivered to base + structures per
second alive). It reports per-unit σ, first-half vs full convergence, and
odd/even seed-block deltas — the spec's stability grades (c)/(d). Slow bruisers
that die en route price low; fast flyers that slip radar gaps price high. That
gap between workbook cost and achieved value is exactly the signal the sim
exists to produce.

A reference run over all 72 units lives in `docs/PRICE_TABLE.txt`. It already
surfaced a real balance finding: Poison-faction units (Dark Energy, Greenies)
price at **0** against this harness because the workbook's effectiveness matrix
sets Poison × Structure = 0.0 — they cannot scratch a base. The harness informs;
the matrix is the designer's call to revisit (GDD §0: validation informs, never
gates).

## Vertical-slice acceptance checklist (GDD §19.2)

- ✅ Builds and runs with no manual fixes (`npm start`, zero dependencies)
- ✅ Both lanes; walker uses ground, floater uses water, flyer ignores terrain
- ✅ Basic attackers path to the base and damage it; towers ignored unless flagged
  (raider copters are the flagged exception, per GDD §6)
- ✅ Wall/moat reroutes walkers (watch the path swing when you drop one mid-wave);
  placements that would seal the lane are rejected
- ✅ All 3 towers: place (space + cost + build time), fire, take damage, repair
  (crew marches from base), upgrade once, sell (partial refund)
- ✅ Real-time economy: kill → income, spend → build/upgrade/repair, bankruptcy possible
- ✅ Win on surviving 5 waves; lose on base death — with story beats per wave (§3/§11)
- ✅ Deterministic under a fixed seed (headless assert + in-game replay hash check)
- ✅ Combat core callable headless (`npm run headless`, `npm run balance`)

**Vision (minimal, §19.1):** radar-sees-air is *implemented* — flak towers only
engage flyers inside a radar dome (base 9 tiles + each flak's own 6-tile dish).
Air-sees-ground is *stubbed*: flyer vision/`seesGround` ride in the data tables
but don't gate anything in the slice; continent-level fog of war is likewise
visual-only (edge vignette).

## Visual spec coverage

Four-sublayer unit stacks with sensors-lead/weapon-follows lock-on telegraph ·
simple sun shadows everywhere + dim offset altitude shadows for flyers · dirt
kick-up and water wakes/ripples · three-part shots (muzzle flash → visible tracer
→ typed impact) · structure lifecycle FX (ghost tint, construction dust, **gold
pie-sweep** on build/repair/upgrade completion, damage smoke, destruction debris
+ rubble decal, sell puff) · deploy loop with live pricing · troops (repair
crews) marching from the base · rotating camera with re-sorted depth + cinematic
intro auto-rotate · battle log + replay · coin pop with console-style coin sound.

## Extended tiers reached

- **E2 (balance sim)** — full harness with convergence/stability reporting.
- **E3 (partial)** — all 9 factions with tropes + counter graph and the complete
  72-unit roster live as data; the slice fields Ground/Powder.
- **E4 (partial)** — per-wave character story beats drawn from the §11 roster
  (Ground/Powder line) plus win/lose beats.

## Regenerating balance data

```bash
python3 tools/extract_balance.py path/to/bulwark-balance.xlsx
```

rewrites `src/sim/units_data.js` from the workbook — stats stay canonical in the
spreadsheet, never hardcoded (GDD §18).
