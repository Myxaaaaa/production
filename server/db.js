import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);

// WAL + synchronous=FULL: каждая подтверждённая транзакция гарантированно на диске.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Миграции только добавляются в конец списка, существующие не меняются.
const migrations = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name          TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('admin','operator')),
        hourly_rate   INTEGER NOT NULL DEFAULT 0,  -- тыйынов за час
        shift_rate    INTEGER NOT NULL DEFAULT 0,  -- тыйынов за смену
        percent       REAL    NOT NULL DEFAULT 0,  -- % от прибыли смены
        active        INTEGER NOT NULL DEFAULT 1,
        token_version INTEGER NOT NULL DEFAULT 0,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL DEFAULT ${NOW},
        updated_at    TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE shifts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_at    TEXT NOT NULL,
        end_at      TEXT,
        profit      INTEGER,                      -- тыйыны
        hourly_rate INTEGER NOT NULL DEFAULT 0,   -- ставки фиксируются на момент открытия
        shift_rate  INTEGER NOT NULL DEFAULT 0,
        percent     REAL    NOT NULL DEFAULT 0,
        note        TEXT NOT NULL DEFAULT '',
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT ${NOW},
        updated_at  TEXT NOT NULL DEFAULT ${NOW},
        CHECK (end_at IS NULL OR end_at > start_at),
        CHECK (end_at IS NULL OR profit IS NOT NULL)
      );
      CREATE INDEX idx_shifts_start ON shifts(start_at);
      CREATE INDEX idx_shifts_user_start ON shifts(user_id, start_at);
      CREATE UNIQUE INDEX idx_shifts_one_open ON shifts(user_id) WHERE end_at IS NULL;

      CREATE TABLE adjustments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('bonus','fine')),
        amount     INTEGER NOT NULL CHECK (amount > 0),
        reason     TEXT NOT NULL DEFAULT '',
        date       TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_adjustments_date ON adjustments(date);

      CREATE TABLE notifications (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        kind           TEXT NOT NULL DEFAULT 'info' CHECK (kind IN ('info','payday','bonus','fine')),
        title          TEXT NOT NULL,
        body           TEXT NOT NULL DEFAULT '',
        payday_date    TEXT,
        target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at     TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_notifications_created ON notifications(created_at);

      CREATE TABLE notification_reads (
        notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at         TEXT NOT NULL DEFAULT ${NOW},
        PRIMARY KEY (notification_id, user_id)
      );
    `,
  },
];

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT ${NOW}
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    tx(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    console.log(`[db] применена миграция ${m.version}_${m.name}`);
  }
}

export function closeDb() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    db.close();
  } catch {}
}
