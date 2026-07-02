// App shell: main menu (play / replays / settings-volume), pause overlay,
// screen management, and the live-vs-replay game lifecycle.

import { Game } from './game.js';
import { Renderer } from './render/renderer.js';
import { loadReplays, deleteReplay } from './sim/replay.js';
import { generateLayout } from './sim/map.js';
import { getSettings, setSetting, onSettingsChange } from './settings.js';
import { Sfx, unlockAudio } from './audio.js';
import { WAVES } from './sim/data.js';

const $ = (sel) => document.querySelector(sel);

class App {
  constructor() {
    this.game = null;
    this.menuBg = null;
    this.bindMenu();
    this.bindSettings();
    this.showScreen('menu');
  }

  showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (name) $('#screen-' + name).classList.remove('hidden');
    const wantBg = ['menu', 'replays', 'settings'].includes(name);
    if (wantBg && !this.menuBg) this.startMenuBg();
    if (!wantBg && this.menuBg) this.stopMenuBg();
    if (name === 'replays') this.renderReplays();
  }

  // slowly rotating live board behind the menu — the shaders idle on display,
  // on a freshly generated random map each visit
  startMenuBg() {
    const host = $('#menu-bg');
    this.menuBg = new Renderer(host, generateLayout((Math.random() * 0xffffffff) >>> 0).layout);
    this.menuBg.cam.targetZoom = 1.12;
    const dummy = { units: [], structures: [], projectiles: [], getStructure: () => null };
    this.menuBgTicker = () => {
      this.menuBg.cam.targetRot += 0.0006;
      this.menuBg.draw(dummy, 0, this.menuBg.app.ticker.deltaMS / 1000);
    };
    this.menuBg.app.ticker.add(this.menuBgTicker);
  }
  stopMenuBg() {
    if (!this.menuBg) return;
    this.menuBg.app.ticker.remove(this.menuBgTicker);
    this.menuBg.destroy();
    $('#menu-bg').innerHTML = '';
    this.menuBg = null;
  }

  bindMenu() {
    $('#btn-play').onclick = () => {
      unlockAudio(); Sfx.click();
      const seedStr = $('#seed-input').value.trim();
      const seed = seedStr ? (Number(seedStr) >>> 0) || strSeed(seedStr) : (Math.random() * 0xffffffff) >>> 0;
      this.startGame({ seed });
    };
    $('#btn-replays').onclick = () => { unlockAudio(); Sfx.click(); this.showScreen('replays'); };
    $('#btn-settings').onclick = () => { unlockAudio(); Sfx.click(); this.showScreen('settings'); };
    for (const b of document.querySelectorAll('.btn-back')) {
      b.onclick = () => { Sfx.click(); this.showScreen('menu'); };
    }
    // pause overlay
    $('#btn-resume').onclick = () => { Sfx.click(); if (this.game) this.game.setPaused(false); };
    $('#btn-quit').onclick = () => { Sfx.click(); this.endGame(); this.showScreen('menu'); };
  }

  bindSettings() {
    // two slider sets (settings screen + pause overlay) stay in sync through
    // the settings store: any change rebroadcasts to every bound input.
    const bound = [];
    const wire = (id, key, testSound) => {
      const input = $(id);
      input.value = getSettings()[key];
      input.oninput = () => setSetting(key, Number(input.value));
      if (testSound) input.onchange = () => { unlockAudio(); Sfx.coin(); };
      bound.push([input, key]);
    };
    wire('#vol-master', 'masterVolume', true);
    wire('#vol-sfx', 'sfxVolume', true);
    wire('#vol-amb', 'ambienceVolume', true);
    wire('#pvol-master', 'masterVolume');
    wire('#pvol-sfx', 'sfxVolume');
    wire('#pvol-amb', 'ambienceVolume');
    onSettingsChange((s) => {
      for (const [input, key] of bound) {
        if (Number(input.value) !== s[key]) input.value = s[key];
      }
    });
    $('#btn-test-sound').onclick = () => { unlockAudio(); Sfx.pieSweep(); };
  }

  renderReplays() {
    const list = $('#replay-list');
    const replays = loadReplays();
    list.innerHTML = replays.length ? '' :
      '<div class="replay-empty">No battles recorded yet. Every battle silently writes a log — play one, then come back to re-watch it, deterministically.</div>';
    replays.forEach((log, i) => {
      const d = new Date(log.date || 0);
      const row = document.createElement('div');
      row.className = 'replay-row';
      row.innerHTML = `
        <div class="replay-info">
          <div class="replay-title">${log.outcome === 'win' ? '⚑ Victory' : '☠ Defeat'} — wave ${log.wavesCleared}/${WAVES.length}</div>
          <div class="replay-meta">${d.toLocaleString()} · seed ${log.seed} · ${log.commands.length} commands · ${Math.round(log.ticks / 30)}s · hash <code>${log.finalHash}</code></div>
        </div>
        <button class="menu-btn small watch">▶ Watch</button>
        <button class="menu-btn small danger del">✕</button>`;
      row.querySelector('.watch').onclick = () => { Sfx.click(); this.startGame({ replayLog: log }); };
      row.querySelector('.del').onclick = () => { Sfx.click(); deleteReplay(i); this.renderReplays(); };
      list.appendChild(row);
    });
  }

  startGame(opts) {
    this.endGame();
    this.showScreen(null);
    $('#screen-game').classList.remove('hidden');
    const host = $('#game-host');
    this.game = new Game(host, {
      ...opts,
      onExit: (why, payload) => {
        const seed = this.game.seed;
        this.endGame();
        if (why === 'again') this.startGame({ seed: (Math.random() * 0xffffffff) >>> 0 });
        else if (why === 'replay') this.startGame({ replayLog: payload });
        else this.showScreen('menu');
      },
      onPauseChange: (p) => {
        $('#pause-overlay').classList.toggle('hidden', !p);
      },
    });
    window.BULWARK = { game: this.game }; // debug/test hook
  }

  endGame() {
    if (this.game) { this.game.destroy(); this.game = null; }
    $('#game-host').innerHTML = '';
    $('#pause-overlay').classList.add('hidden');
    $('#screen-game').classList.add('hidden');
  }
}

function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

window.addEventListener('DOMContentLoaded', () => new App());
