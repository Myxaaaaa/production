import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { localNow } from './util.js';

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
  {
    // Смены больше не открываются вручную: у сотрудника есть график (workdays),
    // каждый день графика — это смена. Невыход отмечается статусом 'absent' с причиной.
    version: 2,
    name: 'schedule',
    up() {
      db.exec(`
        ALTER TABLE users ADD COLUMN default_start TEXT NOT NULL DEFAULT '10:00';
        ALTER TABLE users ADD COLUMN default_end   TEXT NOT NULL DEFAULT '22:00';

        CREATE TABLE workdays (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date           TEXT NOT NULL,                -- YYYY-MM-DD (часовой пояс бизнеса)
          start_time     TEXT NOT NULL,                -- HH:MM
          end_time       TEXT NOT NULL,                -- HH:MM; не позже начала = следующий день
          status         TEXT NOT NULL DEFAULT 'work' CHECK (status IN ('work','absent')),
          absence_reason TEXT NOT NULL DEFAULT '',
          absence_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          absence_at     TEXT,
          profit         INTEGER,                      -- тыйыны; NULL — ещё не внесена
          profit_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
          profit_at      TEXT,
          hourly_rate    INTEGER NOT NULL DEFAULT 0,
          shift_rate     INTEGER NOT NULL DEFAULT 0,
          percent        REAL    NOT NULL DEFAULT 0,
          note           TEXT NOT NULL DEFAULT '',
          created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at     TEXT NOT NULL DEFAULT ${NOW},
          updated_at     TEXT NOT NULL DEFAULT ${NOW},
          CHECK (status = 'work' OR profit IS NULL)
        );
        CREATE UNIQUE INDEX idx_workdays_user_date ON workdays(user_id, date);
        CREATE INDEX idx_workdays_date ON workdays(date);
      `);

      // Переносим старые смены в график: одна запись на сотрудника в день.
      const merged = new Map();
      for (const s of db.prepare('SELECT * FROM shifts ORDER BY user_id, start_at').all()) {
        const start = localNow(new Date(s.start_at));
        const end = localNow(new Date(s.end_at || Date.parse(s.start_at) + 8 * 3600000));
        const key = `${s.user_id}|${start.date}`;
        const m = merged.get(key);
        if (!m) {
          merged.set(key, { ...s, date: start.date, start_time: start.time, end_time: end.time });
        } else {
          m.end_time = end.time;
          if (s.profit !== null) m.profit = (m.profit ?? 0) + s.profit;
          if (s.note) m.note = m.note ? `${m.note}; ${s.note}` : s.note;
        }
      }
      const ins = db.prepare(
        `INSERT INTO workdays (user_id, date, start_time, end_time, profit, profit_by, profit_at, hourly_rate,
           shift_rate, percent, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of merged.values()) {
        ins.run(m.user_id, m.date, m.start_time, m.end_time, m.profit, m.profit === null ? null : m.user_id, m.end_at,
          m.hourly_rate, m.shift_rate, m.percent, m.note.slice(0, 500), m.created_by, m.created_at, m.updated_at);
      }
      db.exec('DROP TABLE shifts');

      // Бонусы и штрафы привязываем к календарной дате, как и дни графика.
      const upd = db.prepare('UPDATE adjustments SET date = ? WHERE id = ?');
      for (const a of db.prepare('SELECT id, date FROM adjustments').all()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) upd.run(localNow(new Date(a.date)).date, a.id);
      }
    },
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
      if (m.up) m.up();
      else db.exec(m.sql);
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
