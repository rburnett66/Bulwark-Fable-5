// Screen-space HUD (layer 14 — never rotates). All DOM: top bar, build bar
// with live pricing, structure context menu (upgrade/repair/sell), wave
// banners, story toasts, end screen.

import { TOWERS, SLICE, WAVES, STORY } from '../sim/data.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class Hud {
  constructor(host, { onSelectBuild, onStartWave, onSpeed, onPause, onStructureAction, onRotate, onZoom, replayMode }) {
    this.host = host;
    this.replayMode = replayMode;
    this.cb = { onSelectBuild, onStartWave, onSpeed, onPause, onStructureAction, onRotate, onZoom };
    this.root = el('div', 'hud');
    host.appendChild(this.root);

    // ---- top bar ----
    this.top = el('div', 'hud-top');
    this.goldEl = el('div', 'hud-stat gold', '');
    this.hpWrap = el('div', 'hud-hp');
    this.hpWrap.innerHTML = '<div class="hud-hp-label">BASE</div><div class="hud-hp-bar"><div class="hud-hp-fill"></div></div><div class="hud-hp-num"></div>';
    this.waveEl = el('div', 'hud-stat wave', '');
    this.timerBtn = el('button', 'hud-btn wave-btn', '');
    this.timerBtn.onclick = () => this.cb.onStartWave();
    this.speedBtn = el('button', 'hud-btn', '1×');
    this.speedBtn.onclick = () => { this.speed = this.speed === 2 ? 1 : 2; this.speedBtn.textContent = this.speed + '×'; this.cb.onSpeed(this.speed); };
    this.speed = 1;
    this.pauseBtn = el('button', 'hud-btn', '☰');
    this.pauseBtn.title = 'Menu / pause';
    this.pauseBtn.onclick = () => this.cb.onPause();
    this.top.append(this.goldEl, this.hpWrap, this.waveEl, this.timerBtn, this.speedBtn, this.pauseBtn);
    this.root.appendChild(this.top);

    // ---- camera controls ----
    const cam = el('div', 'hud-cam');
    for (const [label, title, fn] of [
      ['⟲', 'Rotate left (Q)', () => this.cb.onRotate(-1)],
      ['⟳', 'Rotate right (E)', () => this.cb.onRotate(1)],
      ['+', 'Zoom in', () => this.cb.onZoom(1.2)],
      ['−', 'Zoom out', () => this.cb.onZoom(1 / 1.2)],
    ]) {
      const b = el('button', 'hud-btn', label);
      b.title = title;
      b.onclick = fn;
      cam.appendChild(b);
    }
    this.root.appendChild(cam);

    // ---- build bar (structure list with live pricing — spec §8) ----
    this.buildBar = el('div', 'hud-build');
    this.buildBtns = {};
    let hotkey = 1;
    for (const kind of ['cannon', 'flak', 'wall']) {
      const t = TOWERS[kind];
      const b = el('button', 'build-card', `
        <div class="build-icon ${kind}"></div>
        <div class="build-name">${t.name}</div>
        <div class="build-price">🪙 ${t.cost[0]}</div>
        <div class="build-key">${hotkey}</div>`);
      b.title = t.desc;
      b.onclick = () => this.cb.onSelectBuild(kind);
      this.buildBar.appendChild(b);
      this.buildBtns[kind] = b;
      hotkey++;
    }
    if (replayMode) this.buildBar.style.display = 'none';
    this.root.appendChild(this.buildBar);

    // ---- structure popup ----
    this.popup = el('div', 'struct-popup hidden');
    this.root.appendChild(this.popup);

    // ---- banners & toasts ----
    this.banner = el('div', 'hud-banner hidden');
    this.root.appendChild(this.banner);
    this.toastWrap = el('div', 'hud-toasts');
    this.root.appendChild(this.toastWrap);

    if (replayMode) {
      const badge = el('div', 'replay-badge', '⏵ REPLAY — reconstructed from the battle log');
      this.root.appendChild(badge);
    }

    this.hpFill = this.hpWrap.querySelector('.hud-hp-fill');
    this.hpNum = this.hpWrap.querySelector('.hud-hp-num');
    this.selectedBuild = null;
    this.popupFor = null;
  }

  setBuildSelection(kind) {
    this.selectedBuild = kind;
    for (const [k, b] of Object.entries(this.buildBtns)) b.classList.toggle('selected', k === kind);
  }

  update(sim) {
    this.goldEl.innerHTML = `🪙 <b>${Math.floor(sim.gold)}</b>`;
    const hp01 = Math.max(0, sim.baseHP / sim.baseMaxHP);
    this.hpFill.style.width = (hp01 * 100).toFixed(1) + '%';
    this.hpFill.style.background = hp01 > 0.4 ? '#6fdb47' : '#e74c3c';
    this.hpNum.textContent = `${Math.ceil(sim.baseHP)} / ${sim.baseMaxHP}`;
    this.waveEl.innerHTML = `WAVE <b>${Math.min(sim.wave + (sim.waveState === 'active' ? 0 : 0), WAVES.length)}${sim.waveState === 'build' ? '→' + Math.min(sim.wave + 1, WAVES.length) : ''}</b>/${WAVES.length}`;

    if (sim.waveState === 'build' && !this.replayMode) {
      const secs = Math.max(0, Math.ceil((sim.nextWaveAt - sim.tick) / 30));
      this.timerBtn.textContent = `▶ Start wave (${secs}s)`;
      this.timerBtn.classList.remove('hidden');
    } else {
      this.timerBtn.classList.add('hidden');
    }

    for (const [k, b] of Object.entries(this.buildBtns)) {
      b.classList.toggle('poor', sim.gold < TOWERS[k].cost[0]);
    }

    // keep popup in sync
    if (this.popupFor) {
      const s = sim.getStructure(this.popupFor);
      if (!s) this.hidePopup();
      else this.renderPopup(sim, s);
    }
  }

  // ---- structure context menu (spec §5/§8) ----
  showPopup(sim, s, screenPos) {
    this.popupFor = s.id;
    this.popup.classList.remove('hidden');
    this.popupPos = screenPos;
    this.renderPopup(sim, s);
  }
  renderPopup(sim, s) {
    const canUp = s.tier < 1 && s.state === 'ready';
    const upPrice = s.def.cost[s.tier + 1] - s.def.cost[s.tier];
    const sellPrice = Math.round(s.invested * SLICE.sellRefundFrac);
    const damaged = s.hp < s.maxHp - 0.5;
    const busy = s.state !== 'ready';
    this.popup.innerHTML = `
      <div class="sp-title">${s.def.name} <span class="sp-tier">T${s.tier + 1}</span></div>
      <div class="sp-row">HP ${Math.ceil(s.hp)} / ${s.maxHp}${s.def.dps[s.tier] ? ` · DMG ${s.def.dps[s.tier]}/s` : ''}${s.def.range ? ` · RNG ${s.def.range}` : ''}</div>
      ${busy ? `<div class="sp-row sp-busy">${s.state === 'building' ? 'Under construction…' : 'Upgrading…'}</div>` : ''}
      <div class="sp-actions">
        <button class="sp-btn up" ${canUp && sim.gold >= upPrice ? '' : 'disabled'}>⬆ Upgrade 🪙${upPrice}</button>
        <button class="sp-btn rep" ${damaged && !busy && !s.repairCrew && sim.gold >= SLICE.repairCrewFee ? '' : 'disabled'}>
          🔧 Repair ${s.repairCrew ? '(crew en route)' : '🪙' + SLICE.repairCrewFee}</button>
        <button class="sp-btn sell">💰 Sell +🪙${sellPrice}</button>
      </div>`;
    if (this.replayMode) this.popup.querySelectorAll('button').forEach(b => b.disabled = true);
    this.popup.querySelector('.up').onclick = () => this.cb.onStructureAction('upgrade', s.id);
    this.popup.querySelector('.rep').onclick = () => this.cb.onStructureAction('repair', s.id);
    this.popup.querySelector('.sell').onclick = () => this.cb.onStructureAction('sell', s.id);
    if (this.popupPos) {
      const pad = 12;
      let x = this.popupPos.x + 30, y = this.popupPos.y - 40;
      const r = this.popup.getBoundingClientRect();
      x = Math.min(x, window.innerWidth - r.width - pad);
      y = Math.min(Math.max(y, pad + 50), window.innerHeight - r.height - pad);
      this.popup.style.left = x + 'px';
      this.popup.style.top = y + 'px';
    }
  }
  hidePopup() { this.popupFor = null; this.popup.classList.add('hidden'); }

  showBanner(text, sub = '', dur = 2600) {
    this.banner.innerHTML = `<div class="banner-main">${text}</div>${sub ? `<div class="banner-sub">${sub}</div>` : ''}`;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.banner.classList.add('hidden'), dur);
  }

  /** story beat: character line (GDD §3 — victory grants story) */
  storyToast(beat, dur = 7000) {
    const t = el('div', 'toast', `
      <div class="toast-portrait">${beat.who.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
      <div class="toast-body"><div class="toast-who">${beat.who} <span class="toast-align">[${beat.align}]</span></div>
      <div class="toast-text">${beat.text}</div></div>`);
    this.toastWrap.appendChild(t);
    setTimeout(() => t.classList.add('show'), 30);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, dur);
  }

  toast(text, dur = 3000) {
    const t = el('div', 'toast small show', `<div class="toast-body"><div class="toast-text">${text}</div></div>`);
    this.toastWrap.appendChild(t);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, dur);
  }

  showEnd(outcome, sim, { onMenu, onWatchReplay, onAgain, verified }) {
    const beat = outcome === 'win' ? STORY.win : STORY.lose;
    const overlay = el('div', 'end-overlay', `
      <div class="end-card">
        <div class="end-title ${outcome}">${outcome === 'win' ? '⚑ OUTPOST HELD' : '☠ OUTPOST FALLEN'}</div>
        <div class="end-story"><b>${beat.who}</b> — “${beat.text}”</div>
        <div class="end-stats">
          Waves cleared: <b>${outcome === 'win' ? sim.wave : sim.wave - 1}/${WAVES.length}</b> ·
          Base HP: <b>${Math.max(0, Math.ceil(sim.baseHP))}</b> ·
          Gold: <b>${Math.floor(sim.gold)}</b><br>
          Battle log: <b>${sim.log.commands.length}</b> commands · seed <b>${sim.seed}</b> ·
          hash <code>${sim.hash()}</code>
          ${verified !== undefined ? `<br><span class="${verified ? 'ok' : 'bad'}">${verified ? '✓ deterministic — replay hash matches' : '✗ hash mismatch!'}</span>` : ''}
        </div>
        <div class="end-actions"></div>
      </div>`);
    const actions = overlay.querySelector('.end-actions');
    for (const [label, fn] of [
      ['▶ Play again', onAgain],
      ['🎬 Watch replay', onWatchReplay],
      ['🏠 Main menu', onMenu],
    ].filter(([, f]) => f)) {
      const b = el('button', 'menu-btn', label);
      b.onclick = fn;
      actions.appendChild(b);
    }
    this.root.appendChild(overlay);
  }

  destroy() { this.root.remove(); }
}
