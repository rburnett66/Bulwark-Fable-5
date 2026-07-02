// BULWARK — canonical balance data, transcribed from bulwark-balance.xlsx.
// Everything gameplay-affecting lives here as data (GDD §18: no hardcoded balance).
// The full 72-unit roster is in units_data.js (auto-generated from the workbook).

import { UNITS_ALL } from './units_data.js';

export { UNITS_ALL };

// ---- Assumptions sheet ------------------------------------------------------
export const ASSUMPTIONS = {
  HP_per_point: 10,
  DPS_per_point: 1.5,
  Range_per_point: 0.25,
  Speed_per_point: 0.08,
  Vision_base: 4,
  Vision_per_util_point: 0.1,
  Cost_per_power_gold: 3,
  Upgrade_HP_x: [1, 1.6, 2.4],       // T1..T3
  Upgrade_DPS_x: [1, 1.55, 2.3],
  Upgrade_Cost_x: [1, 2.5, 5],       // cumulative value multipliers
};

// ---- DamageTypes + Effectiveness sheets ------------------------------------
// Effectiveness: damage type × armor class multiplier (matchup texture on top
// of the even 100-pt power budget).
export const EFFECTIVENESS = {
  Kinetic:    { Organic: 1.0, Machinery: 1.0, Aircraft: 1.0, Structure: 1.0, Energy: 1.1 },
  Fire:       { Organic: 1.3, Machinery: 0.8, Aircraft: 0.8, Structure: 1.1, Energy: 0.8 },
  Poison:     { Organic: 1.8, Machinery: 0.1, Aircraft: 0.1, Structure: 0.0, Energy: 0.0 },
  Concussion: { Organic: 0.4, Machinery: 1.7, Aircraft: 0.9, Structure: 1.0, Energy: 0.4 },
  Electric:   { Organic: 0.5, Machinery: 1.8, Aircraft: 1.2, Structure: 0.5, Energy: 0.6 },
  Frost:      { Organic: 0.6, Machinery: 0.6, Aircraft: 0.5, Structure: 0.5, Energy: 0.9 },
};

// Status effects keyed by damage type (DamageTypes sheet). Frost applies NO
// slow to air units (design rule); poison/fire are DoT; electric chains.
export const DAMAGE_STATUS = {
  Kinetic:    null,
  Fire:       { kind: 'Burn',     dotFrac: 0.5, duration: 3.0 },           // extra 50% of hit over 3s
  Poison:     { kind: 'Toxin',    dotFrac: 0.8, duration: 4.0 },
  Concussion: { kind: 'Stagger',  stunMachinery: 0.5 },                    // brief machine stagger
  Electric:   { kind: 'Overload', chainRadius: 1.5, chainFrac: 0.4, stunMachinery: 0.8 },
  Frost:      { kind: 'Chill',    slowFactor: 0.55, duration: 2.0, noSlowVsAir: true },
};

// ---- Factions sheet (counter graph; used for roster/meta screens + harness) -
export const FACTIONS = [
  { id: 'GND', name: 'Ground / Powder', trope: 'Nationalistic',            beats: 'GRN', signature: 'Kinetic' },
  { id: 'AIR', name: 'Air',             trope: 'Manga (ace pilots)',       beats: 'GND', signature: 'Kinetic' },
  { id: 'HTC', name: 'High Tech',       trope: 'Capitalist (mega-corp)',   beats: 'AIR', signature: 'Electric' },
  { id: 'ART', name: 'Artillery',       trope: 'Military (siege)',         beats: 'HTC', signature: 'Concussion' },
  { id: 'WTR', name: 'Water',           trope: 'Fantasy RPG (sea tribes)', beats: 'ART', signature: 'Frost' },
  { id: 'ARC', name: 'Arcane / Energy', trope: 'Fantasy theocracy',        beats: 'WTR', signature: 'Fire' },
  { id: 'SPC', name: 'Space Tech',      trope: 'Sci-Fi (federation)',      beats: 'ARC', signature: 'Electric' },
  { id: 'DRK', name: 'Dark Energy',     trope: 'Social realignment',       beats: 'SPC', signature: 'Poison' },
  { id: 'GRN', name: 'Greenies (Chem)', trope: 'Socialist collective',     beats: 'DRK', signature: 'Poison' },
];

// ---- Structures sheet (slice towers + terrain piece) ------------------------
// hp/dps arrays are T1..T3; the slice UI exposes one upgrade (T1→T2).
export const TOWERS = {
  cannon: {
    id: 'cannon', name: 'Cannon Tower', armor: 'Structure', dmgType: 'Kinetic',
    cost: [150, 375, 750], buildTime: 10, hp: [500, 800, 1200], dps: [45, 69.75, 103.5],
    range: 4, canTarget: 'Ground', aoe: 1, footprint: 1,
    desc: 'Anti-ground emplacement. Splash vs walkers & floaters. Cannot hit air; swimmers take half damage (sub-surface).',
  },
  flak: {
    id: 'flak', name: 'Flak Tower', armor: 'Structure', dmgType: 'Kinetic',
    cost: [150, 375, 750], buildTime: 10, hp: [400, 640, 960], dps: [40, 62, 92],
    range: 5, canTarget: 'Air', aoe: 1, footprint: 1, radar: 6,
    desc: 'Anti-air emplacement with its own radar dome (6 tiles). Only fires at radar-detected flyers.',
  },
  wall: {
    id: 'wall', name: 'Wall / Moat', armor: 'Structure', dmgType: null,
    cost: [60, 150, 300], buildTime: 6, hp: [900, 1440, 2160], dps: [0, 0, 0],
    range: 0, canTarget: null, aoe: 0, footprint: 1,
    desc: 'Terrain piece. Blocks and reroutes walkers; flyers ignore it. Cannot seal the lane completely.',
  },
};

export const ATTACK_INTERVALS = { // seconds between shots, per shape class
  'Troops': 0.5, 'Trucks': 1.0, 'Tanks': 0.9, 'Artillery': 2.0,
  'Heavy Tanks': 1.2, 'Copters': 0.6, 'Planes': 0.8, 'Missiles': 1.0,
  cannon: 0.8, flak: 0.45,
};

// ---- Vertical_Slice sheet ----------------------------------------------------
export const SLICE = {
  wavesToWin: 5,
  baseHP: 2000,
  startingGold: 800,
  incomePerKillFrac: 0.35,     // income per kill = unit Cost T1 × 0.35
  waveClearBounty: 100,        // GDD §3 wave-clear bounty
  buildPhaseSec: 25,           // between waves (Start Wave skips it)
  sellRefundFrac: 0.5,
  repairCrewFee: 20,           // repairs are free; the crew is not (visual spec §5)
  repairRate: 55,              // hp/sec once the crew arrives
  repairCrewSpeed: 2.4,        // tiles/sec, marches from base
  baseRadar: 9,                // base radar dome, tiles (radar sees air, not ground)
  subSurfaceDamageTaken: 0.5,  // swimmers ride sub-surface: harder to hit
};

export function unitById(id) { return UNITS_ALL.find(u => u.id === id); }

// Slice attackers (Vertical_Slice sheet). GND-Trucks is fielded as an
// amphibious floater for the water lane (documented domain override).
// The "raider" copter is the slice's flagged structure-attacker (GDD §6: only
// flagged units target structures) so towers take damage and repair matters.
export const SLICE_ATTACKERS = {
  walker:  { unit: 'GND-Troops',  domain: 'Walker' },
  floater: { unit: 'GND-Trucks',  domain: 'Floater' },
  flyer:   { unit: 'GND-Copters', domain: 'Flyer' },
  raider:  { unit: 'GND-Copters', domain: 'Flyer', targetsStructures: true, label: 'Raider Copter' },
};

// Wave compositions — [kind, count] pairs, spawned interleaved with seeded jitter.
export const WAVES = [
  { name: 'Skirmish line',   spawns: [['walker', 4]] },
  { name: 'Amphibious push', spawns: [['walker', 6], ['floater', 2]] },
  { name: 'Combined arms',   spawns: [['walker', 5], ['floater', 3], ['flyer', 2]] },
  { name: 'Raider screen',   spawns: [['walker', 6], ['floater', 4], ['flyer', 3], ['raider', 1]] },
  { name: 'The Iron Tide',   spawns: [['walker', 8], ['floater', 5], ['flyer', 4], ['raider', 2]] },
];

// ---- Story beats (GDD §3 “each cleared wave grants story”, §11.1 roster) ----
export const STORY = {
  intro: { who: 'Field-Marshal Seraphine von Halbrecht', align: 'AG',
    text: 'The old empire marches on your clearing. Honor the oaths — hold the outpost, and stain nothing.' },
  waves: [
    { who: 'Sergeant "Bricks" Malloy', align: 'CG', text: 'Skirmishers probing the treeline. Rules are for parades — put cannon where they walk, not where it looks tidy.' },
    { who: 'Quartermaster Ines Roth', align: 'N', text: 'Barges on the river. Someone counts the powder while they wave flags — cover the water lane or go broke repairing.' },
    { who: 'Captain Otto von Halbrecht', align: 'G', text: 'Copters over the ridge — Skylark taught me their lines. Radar sees air; keep a flak dome awake.' },
    { who: 'General Kord Stahl', align: 'E', text: 'Raiders have orders to burn your emplacements. The empire\'s glory justifies every grave. Repair crews forward.' },
    { who: 'Chancellor Wilhelmina Graf', align: 'PE', text: 'The Iron Tide. Order is worth any cruelty. Survive this, and even the balance-keepers will nod.' },
  ],
  win:  { who: 'Field-Marshal Seraphine von Halbrecht', align: 'AG',
    text: 'The clearing holds. Beat a faction, learn a faction — Ground/Powder\'s armory is yours now. One scale up awaits.' },
  lose: { who: 'The Iron Regent', align: 'DE',
    text: 'Nations are furnaces. Yours just became fuel. Rebuild, and reroute them next time.' },
};

// ---- Biome palette (GDD §15 — reskin = table change, not new logic) ---------
export const PALETTE = {
  biome: 'Verdant Clearing',
  groundLow: 0x6f9a4e, groundMid: 0x7fa957, groundHigh: 0x8fb763,
  dirt: 0x9b7f52, grass: 0x5d8a43, bush: 0x4c7a3a,
  treeCanopy: 0x3f6f34, treeTrunk: 0x6b4a2c,
  waterDeep: 0x1d4e6e, waterShallow: 0x2e6f92, waterFoam: 0xbfe3ef,
  cloud: 0xf4f7fa, fog: 0x0b1420,
  shadow: 0x14210f,
  enemyBody: 0x8a6d3f, enemyAccent: 0xc23b2e, enemyDark: 0x4f3f24,   // Ground/Powder khaki + crimson
  playerBody: 0x5b7f9e, playerAccent: 0x3fd0ff, playerDark: 0x2c3e50, // outpost steel + cyan
  gold: 0xffd54a, hp: 0x7CFC00, damage: 0xff5544,
};

export const SIM_TICK_RATE = 30; // fixed-step ticks per second
