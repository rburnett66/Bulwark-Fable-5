// All SFX are synthesized with WebAudio — no asset files, fully offline.
// The coin pickup is a classic-console two-tone arpeggio (visual spec §10).

import { getSettings, onSettingsChange } from './settings.js';

let ctx = null, master = null, sfxBus = null, ambBus = null;

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  ambBus = ctx.createGain();
  ambBus.connect(master);
  applyVolumes();
  onSettingsChange(applyVolumes);
  startAmbience();
  return true;
}

function applyVolumes() {
  const s = getSettings();
  if (!master) return;
  master.gain.value = s.masterVolume;
  sfxBus.gain.value = s.sfxVolume;
  ambBus.gain.value = s.ambienceVolume * 0.24;
}

export function unlockAudio() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
}

function osc(type, freq, dur, { gain = 0.2, slide = null, delay = 0 } = {}) {
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(sfxBus);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur, { gain = 0.2, freq = 1200, q = 1, delay = 0, type = 'lowpass' } = {}) {
  const t0 = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t0);
}

// gentle wind-and-water bed under everything
function startAmbience() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 420;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 160;
  lfo.connect(lfoGain); lfoGain.connect(f.frequency);
  src.connect(f); f.connect(ambBus);
  src.start(); lfo.start();
}

const throttle = {};
function throttled(name, ms) {
  const now = performance.now();
  if (throttle[name] && now - throttle[name] < ms) return true;
  throttle[name] = now;
  return false;
}

export const Sfx = {
  click()      { if (!ensure()) return; osc('square', 660, 0.06, { gain: 0.08 }); },
  cannon()     { if (!ensure() || throttled('cannon', 70)) return; noise(0.12, { gain: 0.18, freq: 700 }); osc('triangle', 130, 0.12, { gain: 0.22, slide: 60 }); },
  flak()       { if (!ensure() || throttled('flak', 60)) return; noise(0.08, { gain: 0.12, freq: 2400, type: 'bandpass', q: 2 }); osc('square', 300, 0.06, { gain: 0.07, slide: 180 }); },
  enemyShot()  { if (!ensure() || throttled('eshot', 90)) return; osc('sawtooth', 220, 0.09, { gain: 0.07, slide: 120 }); },
  impact()     { if (!ensure() || throttled('impact', 60)) return; noise(0.09, { gain: 0.1, freq: 900 }); },
  flakBurst()  { if (!ensure() || throttled('burst', 60)) return; noise(0.14, { gain: 0.12, freq: 1600, type: 'bandpass', q: 0.8 }); },
  explosion()  { if (!ensure() || throttled('boom', 120)) return; noise(0.5, { gain: 0.3, freq: 300 }); osc('triangle', 90, 0.4, { gain: 0.25, slide: 35 }); },
  splash()     { if (!ensure() || throttled('splash', 150)) return; noise(0.25, { gain: 0.14, freq: 1200, type: 'highpass' }); },
  coin() {     // the classic: E6 → B6 square arpeggio
    if (!ensure()) return;
    osc('square', 1318.5, 0.09, { gain: 0.12 });
    osc('square', 1975.5, 0.35, { gain: 0.12, delay: 0.09 });
  },
  build()      { if (!ensure()) return; noise(0.1, { gain: 0.1, freq: 500 }); osc('triangle', 180, 0.1, { gain: 0.1 }); },
  hammer()     { if (!ensure() || throttled('hammer', 300)) return; osc('square', 520, 0.04, { gain: 0.05 }); noise(0.05, { gain: 0.06, freq: 3000, type: 'highpass', delay: 0.01 }); },
  pieSweep() { // universal “done + paid off” gold chime
    if (!ensure()) return;
    osc('sine', 784, 0.14, { gain: 0.14 });
    osc('sine', 988, 0.14, { gain: 0.14, delay: 0.1 });
    osc('sine', 1319, 0.4, { gain: 0.16, delay: 0.2 });
  },
  sell()       { if (!ensure()) return; osc('square', 880, 0.07, { gain: 0.1 }); osc('square', 660, 0.12, { gain: 0.1, delay: 0.07 }); },
  place()      { if (!ensure()) return; osc('triangle', 330, 0.1, { gain: 0.12, slide: 220 }); },
  invalid()    { if (!ensure()) return; osc('square', 160, 0.15, { gain: 0.1, slide: 110 }); },
  waveHorn() {
    if (!ensure()) return;
    osc('sawtooth', 196, 0.5, { gain: 0.14 });
    osc('sawtooth', 247, 0.5, { gain: 0.1, delay: 0.05 });
    osc('sawtooth', 294, 0.7, { gain: 0.12, delay: 0.25 });
  },
  baseHit()    { if (!ensure() || throttled('bhit', 150)) return; noise(0.2, { gain: 0.22, freq: 250 }); osc('sine', 70, 0.25, { gain: 0.2 }); },
  win() {
    if (!ensure()) return;
    [523, 659, 784, 1047].forEach((f, i) => osc('square', f, 0.28, { gain: 0.12, delay: i * 0.16 }));
    osc('square', 1319, 0.7, { gain: 0.12, delay: 0.64 });
  },
  lose() {
    if (!ensure()) return;
    [392, 370, 349, 330].forEach((f, i) => osc('sawtooth', f, 0.4, { gain: 0.12, delay: i * 0.3 }));
  },
  repair()     { if (!ensure() || throttled('repair', 500)) return; osc('square', 700, 0.05, { gain: 0.05 }); osc('square', 900, 0.05, { gain: 0.05, delay: 0.09 }); },
};
