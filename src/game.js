// Game session glue: Sim (fixed 30 Hz steps) + Renderer (interpolated 60 fps)
// + HUD + input. Also drives replay playback: the same loop with commands fed
// from a recorded log instead of the pointer.

import { Sim } from './sim/sim.js';
import { SIM_TICK_RATE, STORY, WAVES, TOWERS } from './sim/data.js';
import { Renderer } from './render/renderer.js';
import { TILE } from './render/terrain.js';
import { Hud } from './ui/hud.js';
import { Sfx, unlockAudio } from './audio.js';
import { finalizeLog, saveReplay } from './sim/replay.js';

const TICK_MS = 1000 / SIM_TICK_RATE;

export class Game {
  /**
   * @param {HTMLElement} host
   * @param {object} opts  { seed, replayLog?, onExit(reason) }
   */
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    this.replayMode = !!opts.replayLog;
    this.seed = this.replayMode ? opts.replayLog.seed : opts.seed;

    this.sim = new Sim({ seed: this.seed });
    if (this.replayMode) this.sim.feedCommands(opts.replayLog.commands);

    this.renderer = new Renderer(host);
    this.hud = new Hud(host, {
      onSelectBuild: (k) => this.selectBuild(k),
      onStartWave: () => { unlockAudio(); this.sim.issueCommand({ type: 'startWave' }); },
      onSpeed: (s) => { this.speed = s; },
      onPause: () => this.setPaused(true),
      onStructureAction: (act, id) => this.structureAction(act, id),
      onRotate: (d) => this.renderer.rotate(d),
      onZoom: (f) => this.renderer.zoom(f),
      replayMode: this.replayMode,
    });

    this.speed = 1;
    this.paused = false;
    this.acc = 0;
    this.buildKind = null;
    this.selectedStruct = null;
    this.hoverTile = null;
    this.ended = false;

    this.bindInput();
    this.renderer.startCinematic();
    this.hud.storyToast(STORY.intro, 8000);
    if (this.replayMode) this.hud.toast('Replaying battle log — inputs are locked, camera is yours.', 5000);

    this.tickerFn = () => this.frame(this.renderer.app.ticker.deltaMS);
    this.renderer.app.ticker.add(this.tickerFn);
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const view = this.renderer.app.view;
    view.style.touchAction = 'none';

    this.onPointerMove = (e) => {
      const rect = view.getBoundingClientRect();
      this.hoverTile = this.renderer.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
    };
    this.onPointerDown = (e) => {
      unlockAudio();
      this.renderer.skipCinematic();
      const rect = view.getBoundingClientRect();
      const t = this.renderer.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
      if (e.button === 2) { this.cancelModes(); return; }
      if (this.replayMode) return;               // watch-only
      if (this.buildKind) {
        const v = this.sim.canPlace(this.buildKind, t.c, t.r);
        if (v.ok) {
          this.sim.issueCommand({ type: 'place', kind: this.buildKind, c: t.c, r: t.r });
          if (!e.shiftKey) this.selectBuild(null); // shift = keep placing
        } else {
          Sfx.invalid();
          this.hud.toast(v.why, 1800);
        }
        return;
      }
      const s = this.sim.structureAt(t.c, t.r);
      if (s) {
        this.selectedStruct = s.id;
        const sp = this.renderer.tileToScreen(s.x, s.y);
        this.hud.showPopup(this.sim, s, sp);
        Sfx.click();
      } else {
        this.selectedStruct = null;
        this.hud.hidePopup();
      }
    };
    this.onKey = (e) => {
      if (e.repeat) return;
      switch (e.key) {
        case '1': this.selectBuild('cannon'); break;
        case '2': this.selectBuild('flak'); break;
        case '3': this.selectBuild('wall'); break;
        case 'Escape':
          if (this.buildKind || this.selectedStruct) this.cancelModes();
          else this.setPaused(!this.paused);
          break;
        case 'q': case 'Q': this.renderer.rotate(-1); break;
        case 'e': case 'E': this.renderer.rotate(1); break;
        case '+': case '=': this.renderer.zoom(1.2); break;
        case '-': this.renderer.zoom(1 / 1.2); break;
        case ' ': if (!this.replayMode) this.sim.issueCommand({ type: 'startWave' }); e.preventDefault(); break;
      }
    };
    this.onCtx = (e) => e.preventDefault();
    view.addEventListener('pointermove', this.onPointerMove);
    view.addEventListener('pointerdown', this.onPointerDown);
    view.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('keydown', this.onKey);
  }

  selectBuild(kind) {
    if (this.replayMode) return;
    this.buildKind = (kind === this.buildKind) ? null : kind;
    this.hud.setBuildSelection(this.buildKind);
    this.hud.hidePopup();
    this.selectedStruct = null;
    if (this.buildKind) Sfx.click();
  }
  cancelModes() {
    this.buildKind = null;
    this.hud.setBuildSelection(null);
    this.selectedStruct = null;
    this.hud.hidePopup();
    this.renderer.placementUI.hideGhost();
  }
  structureAction(act, id) {
    unlockAudio();
    this.sim.issueCommand({ type: act, id });
    if (act === 'sell') { this.selectedStruct = null; this.hud.hidePopup(); }
    Sfx.click();
  }

  setPaused(p) {
    this.paused = p;
    if (this.opts.onPauseChange) this.opts.onPauseChange(p);
  }

  // ------------------------------------------------------------------ loop
  frame(deltaMS) {
    if (!this.paused && !this.ended) {
      this.acc += Math.min(deltaMS, 200) * this.speed;
      let guard = 0;
      while (this.acc >= TICK_MS && guard++ < 8 * this.speed) {
        this.acc -= TICK_MS;
        this.sim.step();
        const evs = this.sim.drainEvents();
        this.renderer.handleEvents(evs, this.sim);
        this.handleGameEvents(evs);
        if (this.sim.over) break;
      }
    }
    const alpha = Math.min(1, this.acc / TICK_MS);
    this.renderer.draw(this.sim, alpha, this.renderer.app.ticker.deltaMS / 1000);

    // placement ghost follows hover
    if (this.buildKind && this.hoverTile) {
      const t = this.hoverTile;
      const v = this.sim.canPlace(this.buildKind, t.c, t.r);
      this.renderer.placementUI.showGhost(this.buildKind, t.c, t.r, v.ok);
    } else {
      this.renderer.placementUI.hideGhost();
    }
    const sel = this.selectedStruct ? this.sim.getStructure(this.selectedStruct) : null;
    this.renderer.placementUI.showSelection(sel, this.renderer.app.ticker.deltaMS / 1000);

    this.hud.update(this.sim);
  }

  handleGameEvents(evs) {
    for (const ev of evs) {
      switch (ev.t) {
        case 'waveStart': {
          const w = WAVES[ev.wave - 1];
          this.hud.showBanner(`WAVE ${ev.wave} — ${w.name}`, `${ev.count} hostiles inbound`);
          this.hud.storyToast(STORY.waves[ev.wave - 1]);
          break;
        }
        case 'waveClear':
          this.hud.showBanner(`WAVE ${ev.wave} CLEARED`, `+🪙${ev.bounty} wave bounty`);
          break;
        case 'rejected':
          this.hud.toast(ev.why, 1800);
          break;
        case 'win':
        case 'lose':
          this.onBattleEnd(ev.t);
          break;
      }
    }
  }

  onBattleEnd(outcome) {
    if (this.ended) return;
    this.ended = true;
    let verified;
    let log = null;
    if (!this.replayMode) {
      log = finalizeLog(this.sim, { date: Date.now(), label: `seed ${this.seed}` });
      saveReplay(log);
    } else {
      verified = this.sim.hash() === this.opts.replayLog.finalHash && this.sim.over === this.opts.replayLog.outcome;
    }
    setTimeout(() => {
      this.hud.showEnd(outcome, this.sim, {
        verified,
        onMenu: () => this.opts.onExit('menu'),
        onAgain: () => this.opts.onExit('again'),
        onWatchReplay: log ? () => this.opts.onExit('replay', log) : null,
      });
    }, 1300);
  }

  destroy() {
    this.renderer.app.ticker.remove(this.tickerFn);
    const view = this.renderer.app.view;
    view.removeEventListener('pointermove', this.onPointerMove);
    view.removeEventListener('pointerdown', this.onPointerDown);
    view.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('keydown', this.onKey);
    this.hud.destroy();
    this.renderer.destroy();
  }
}
