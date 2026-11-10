import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

// VACUUM INTO делает согласованную копию базы без остановки приложения.
export function snapshot(dest) {
  db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
}

function listBackups() {
  return fs
    .readdirSync(config.backupDir)
    .filter((f) => /^app-.*\.db$/.test(f))
    .sort();
}

export function runBackup() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backupDir, `app-${stamp}.db`);
  snapshot(file);
  const all = listBackups();
  for (const f of all.slice(0, Math.max(0, all.length - config.backupKeep))) {
    fs.rmSync(path.join(config.backupDir, f), { force: true });
  }
  console.log(`[backup] сохранена копия ${path.basename(file)}`);
}

export function startBackups() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const intervalMs = config.backupIntervalHours * 3600 * 1000;
  const safeRun = () => {
    try {
      runBackup();
    } catch (e) {
      console.error('[backup] ошибка резервного копирования:', e.message);
    }
  };
  // При частых редеплоях не плодим лишние копии: проверяем возраст последней.
  const last = listBackups().at(-1);
  const lastAge = last ? Date.now() - fs.statSync(path.join(config.backupDir, last)).mtimeMs : Infinity;
  setTimeout(() => {
    safeRun();
    setInterval(safeRun, intervalMs).unref();
  }, Math.max(5000, intervalMs - lastAge)).unref();
}
