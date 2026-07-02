// Persistent player settings (menu → Settings).
const KEY = 'bulwark.settings.v1';
const DEFAULTS = { masterVolume: 0.8, sfxVolume: 0.9, ambienceVolume: 0.5 };

let cache = null;

export function getSettings() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
    catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}

export function setSetting(k, v) {
  const s = getSettings();
  s[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  for (const fn of listeners) fn(s);
}

const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); }
