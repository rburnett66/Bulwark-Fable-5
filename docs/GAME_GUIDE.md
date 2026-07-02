# BULWARK — Player's Guide

*Fortify a clearing. Learn a faction. Beat it.*

You command a lone outpost in a clearing. The Ground/Powder empire — flags, honor,
and far too much artillery — is coming in five waves across land, water, and air.
Hold the base and the faction's armory is yours.

---

## Quick start

```bash
npm start        # → http://localhost:8000
```

Click **▶ Play**. Build a cannon or two where the enemy will walk (keys `1`/`2`/`3`,
then click the map), press **Space** to call the first wave early, and keep your
base alive through wave 5.

---

## Features at a glance

| Feature | What it means in play |
|---|---|
| **Three combat domains** | Walkers march the ground lane, floaters ride the river, flyers ignore terrain entirely. Each needs different defenses. |
| **Organic random maps** | Every game generates a new board from the seed: a winding river with varying width (sometimes a pond), the outpost on either bank, shifting spawn corridors and tree stands. Every map is pathing-verified before you see it. |
| **Terrain is a weapon** | Walls reroute walkers — maze them through your kill zone. The game refuses placements that would fully seal the lane. |
| **Radar rules** | Radar sees air, not ground. Flak only fires at flyers inside a radar dome (your base has one; each flak tower carries its own). |
| **Structure lifecycle** | Everything is placed (space + cost + build time), fires, takes damage, can be repaired, upgraded a tier, or sold for a partial refund. |
| **Real-time economy** | Kills pay 35% of the victim's cost, wave clears pay a bounty — and every coin is spent live, mid-battle. You can go broke. |
| **Flagged raiders** | Basic enemies beeline for your base and ignore towers. Raider copters (wave 4+) are flagged to hunt your structures instead. |
| **Deterministic replays** | Every battle silently records seed + commands. Watch it again from the main menu — the final hash is verified on screen. |
| **Story beats** | Each wave arrives with a line from the Ground/Powder officer roster, from Sergeant Malloy's advice to the Iron Regent's verdict. |
| **Camera & polish** | Rotate the world (Q/E) to see layer parallax, sun-consistent shadows, altitude shadows under flyers, dirt trails, water wakes, and the gold pie-sweep that means "done and paid off." |
| **Sound** | Fully synthesized WebAudio — cannons, flak, coin arpeggios, win/lose jingles. Volume sliders in Settings, persisted. |

---

## How to play

### The goal
Survive **5 waves**. Your base has **2000 HP** and you start with **800 gold**.
Lose the base, lose the battle.

### Reading the map
- **Green** is ground — walkers march here, and it's where you build.
- **Blue** is the river — floaters ride it toward your base. It blocks walkers
  (and your walls can't be built on it).
- **Your outpost** sits in a clearing on one bank, always next to the water —
  which is exactly why the enemy barges can strike it. Cover the shoreline.
- **Trees** block building and walking; they also hide nothing — this is honest
  terrain, not fog (the dashed cyan ring is your base radar).
- The **"Recon" toast** at battle start describes the generated map.

### Your arsenal

| | Cost | Role | Notes |
|---|---|---|---|
| **Cannon Tower** (`1`) | 🪙150 | Anti-ground | Splash damage vs walkers & floaters. Cannot hit air. |
| **Flak Tower** (`2`) | 🪙150 | Anti-air | Own 6-tile radar dome; only fires at radar-detected flyers. |
| **Wall / Moat** (`3`) | 🪙60 | Terrain | Reroutes walkers. Cheap mazing; can never fully seal the lane. |

**Placing:** select a card (or hotkey), hover for the green/red ghost preview,
click to place. **Shift-click** keeps placing. Right-click or `Esc` cancels.
Towers take build time — dust rises, then a **gold pie-sweep** flashes when
they're ready.

**Managing:** click any structure for its menu —
- **⬆ Upgrade** (one tier in the slice): more HP and damage, costs 1.5× base price.
- **🔧 Repair**: repairs are free, the crew is not (🪙20) — a repair troop marches
  out from your base, and the fix takes time. Protect the crew's route.
- **💰 Sell**: 50% of everything invested, instantly.

### The enemy

| Wave | Name | What's coming |
|---|---|---|
| 1 | Skirmish line | Walkers probing the ground lane |
| 2 | Amphibious push | Walkers + barges on the river |
| 3 | Combined arms | Walkers, barges, and copters |
| 4 | Raider screen | Adds a **raider copter** that hunts your towers |
| 5 | The Iron Tide | Everything, in force |

- **Troops** (walkers) — path around your walls, stop at ~2.5 tiles and shoot
  the base. Kill them before they set up.
- **Barges** (floaters) — fast, tough, weak guns. They park at the shoreline
  next to your base; a cannon covering that spot kills them while they siege.
- **Copters** (flyers) — ignore all terrain, hover at range 5 and pound the
  base. Only flak can touch them, and only inside radar.
- **Raider copters** — the exception to "enemies ignore towers": these dive
  your structures. Keep flak coverage over your defenses, then repair.

### Economy rhythm
Each kill drops coins (35% of unit cost). Wave clear = +🪙100. Between waves you
get a 25-second build phase — or press **Space / ▶ Start wave** to skip it and
keep your tempo. Spend continuously: gold sitting in the bank kills no copters.

### Controls

| Input | Action |
|---|---|
| `1` / `2` / `3` | Select cannon / flak / wall |
| Click | Place / select structure |
| Shift-click | Place and keep placing |
| Right-click / `Esc` | Cancel placement or selection |
| `Space` | Send the next wave early |
| `Q` / `E` (or ⟲ ⟳) | Rotate the camera |
| `+` / `−` | Zoom |
| `Esc` | Pause (volume + quit) |
| 1×/2× button | Game speed |

Everything also works with a single pointer/finger — hotkeys are shortcuts,
never requirements.

### Tactics that win
1. **Guard the siege spots.** Enemies stop at attack range and stand still —
   put cannons where they'll be standing, not just along the road.
2. **Cover the shoreline cell next to your base.** That's where every barge ends up.
3. **Two flak minimum by wave 3**, upgraded or reinforced by wave 5. The Iron
   Tide brings six aircraft.
4. **Walls buy seconds; seconds are damage.** A short maze in front of your
   cannons doubles their time on target.
5. **Repair between waves, sell mistakes.** A 50% refund beats a dead tower.

---

## Menus

- **Play** — optional seed field: the same seed always produces the same map and
  the same wave timings. Great for practicing a board or racing a friend.
- **Replays** — the last 12 battles, auto-recorded. Watch any of them: inputs are
  locked, the camera is yours, and the end screen proves the sim replayed
  hash-identically.
- **Settings** — master / effects / ambience volume with a test chime. Persisted.

---

## For tinkerers

```bash
npm run headless    # run a scripted battle twice; asserts identical hashes
npm run balance     # GDD §17 pricing harness (--all for all 72 units)
npm run mapcheck    # audit random map generation across hundreds of seeds
```

All balance lives in `src/sim/data.js` + `src/sim/units_data.js`, generated from
`bulwark-balance.xlsx` — tune the workbook, re-extract, and the game follows.
