import { db } from './db.js';

// Настройки компании. Деньги — в тыйынах.
const DEFAULTS = {
  tz: 'Asia/Bishkek',
  teamDailyGoal: 0,
  windowHours: 3,
  idleMinutes: 45,
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  const out = { ...DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in DEFAULTS) out[r.key] = typeof DEFAULTS[r.key] === 'number' ? Number(r.value) : r.value;
  }
  cache = out;
  return out;
}

export function setSettings(patch) {
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULTS) put.run(k, String(v));
  cache = null;
  return getSettings();
}
