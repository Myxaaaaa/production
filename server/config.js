import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const onRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID);
const volumePath = env.RAILWAY_VOLUME_MOUNT_PATH || '';

const dataDir = path.resolve(env.DATA_DIR || volumePath || 'data');

// Защита от потери данных: на Railway без подключённого volume файловая система
// контейнера стирается при каждом деплое. В этом случае не стартуем вовсе.
if (onRailway && env.ALLOW_EPHEMERAL_DATA !== '1') {
  if (!volumePath) {
    console.error(
      '[FATAL] Сервис запущен на Railway без подключённого Volume. ' +
        'Данные будут потеряны при редеплое. Подключите Volume (например, /data) ' +
        'и задайте DATA_DIR=/data. См. README.md.'
    );
    process.exit(1);
  }
  const rel = path.relative(path.resolve(volumePath), dataDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(
      `[FATAL] DATA_DIR="${env.DATA_DIR}" (это ${dataDir}) находится вне смонтированного Volume (${volumePath}). ` +
        `Задайте в Railway → Variables DATA_DIR=${volumePath} или удалите переменную DATA_DIR.`
    );
    process.exit(1);
  }
}

fs.mkdirSync(dataDir, { recursive: true });

// Секрет для подписи сессий: из env, иначе генерируется один раз и хранится
// рядом с базой, чтобы сессии переживали редеплой.
function loadSessionSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (env.SESSION_SECRET) console.warn('[WARN] SESSION_SECRET короче 32 символов — игнорирую.');
  const file = path.join(dataDir, '.session-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export const config = {
  isProd,
  onRailway,
  port: Number(env.PORT) || 3000,
  dataDir,
  dbFile: path.join(dataDir, 'app.db'),
  backupDir: path.join(dataDir, 'backups'),
  backupKeep: Math.max(1, Number(env.BACKUP_KEEP) || 14),
  backupIntervalHours: Math.max(1, Number(env.BACKUP_INTERVAL_HOURS) || 24),
  sessionSecret: loadSessionSecret(),
  sessionDays: Math.max(1, Number(env.SESSION_DAYS) || 30),
  admin: {
    login: (env.ADMIN_LOGIN || '').trim(),
    password: env.ADMIN_PASSWORD || '',
    name: (env.ADMIN_NAME || 'Администратор').trim(),
    resetPassword: env.ADMIN_RESET_PASSWORD === '1',
  },
};
