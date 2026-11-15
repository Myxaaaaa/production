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
  {
    // Без смен: зарплата = дневной оклад (капает каждый день) + % от каждого поступления прибыли.
    version: 2,
    name: 'daily_pay_and_profit_events',
    sql: `
      ALTER TABLE users ADD COLUMN daily_rate INTEGER NOT NULL DEFAULT 0;   -- тыйынов в день
      ALTER TABLE users ADD COLUMN work_days  INTEGER NOT NULL DEFAULT 127; -- битовая маска, пн = 1 … вс = 64
      ALTER TABLE users ADD COLUMN pay_start  TEXT;                         -- с какой даты капает оклад
      ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 0;   -- цель по прибыли на день

      -- История дневного оклада: изменение ставки не переписывает прошлые дни.
      CREATE TABLE rate_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_date  TEXT NOT NULL,
        daily_rate INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        UNIQUE (user_id, from_date)
      );

      -- Каждое изменение прибыли — отдельная запись. % фиксируется в момент поступления.
      CREATE TABLE profit_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount     INTEGER NOT NULL,
        percent    REAL    NOT NULL DEFAULT 0,
        base_pay   INTEGER NOT NULL DEFAULT 0,   -- только для перенесённых старых смен
        at         TEXT NOT NULL,
        source     TEXT NOT NULL CHECK (source IN ('extension','manual','admin','shift')),
        reading    INTEGER,                      -- что было на странице (для расширения)
        page       TEXT NOT NULL DEFAULT '',
        note       TEXT NOT NULL DEFAULT '',
        client_id  TEXT UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_events_at ON profit_events(at);
      CREATE INDEX idx_events_user_at ON profit_events(user_id, at);

      CREATE TABLE ext_tokens (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash      TEXT NOT NULL UNIQUE,
        label           TEXT NOT NULL DEFAULT '',
        last_seen_at    TEXT,
        last_page       TEXT NOT NULL DEFAULT '',
        last_reading    INTEGER,
        last_reading_at TEXT,
        created_at      TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE days_off (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date    TEXT NOT NULL,
        kind    TEXT NOT NULL CHECK (kind IN ('off','sick','vacation','work')),
        note    TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, date)
      );

      CREATE TABLE payouts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount     INTEGER NOT NULL CHECK (amount > 0),
        date       TEXT NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_payouts_user_date ON payouts(user_id, date);

      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      -- Закрытые смены переносятся в поступления вместе с заработанной по ним ставкой.
      INSERT INTO profit_events (user_id, amount, percent, base_pay, at, source, note, created_by, created_at)
      SELECT user_id, profit, percent,
             shift_rate + CAST(ROUND((julianday(end_at) - julianday(start_at)) * 24 * hourly_rate) AS INTEGER),
             end_at, 'shift', note, created_by, created_at
      FROM shifts WHERE end_at IS NOT NULL AND profit IS NOT NULL;

      UPDATE users SET pay_start = strftime('%Y-%m-%d', 'now', '+6 hours');
    `,
  },
  {
    // Схема оплаты: можно включить только оклад, только % с прибыли или оба.
    version: 3,
    name: 'pay_mode_flags',
    sql: `
      ALTER TABLE users ADD COLUMN pay_fixed   INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN pay_percent INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    // Ручная правка зарплаты администратором и авансы по заявкам сотрудников.
    version: 4,
    name: 'salary_corrections_and_advances',
    sql: `
      CREATE TABLE salary_corrections (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount     INTEGER NOT NULL CHECK (amount != 0),  -- со знаком: + добавить, − убрать
        before     INTEGER NOT NULL DEFAULT 0,            -- баланс к выплате до правки
        reason     TEXT NOT NULL DEFAULT '',
        date       TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_corrections_user_date ON salary_corrections(user_id, date);

      CREATE TABLE advances (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount        INTEGER NOT NULL CHECK (amount > 0),
        reason        TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
        decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        decided_at    TEXT,
        decision_note TEXT NOT NULL DEFAULT '',
        payout_id     INTEGER REFERENCES payouts(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_advances_status ON advances(status, created_at);
      CREATE INDEX idx_advances_user ON advances(user_id, created_at);

      -- Журнал действий по авансам: видно, кто что просил, даже если заявку отменили.
      CREATE TABLE advance_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        advance_id INTEGER NOT NULL REFERENCES advances(id) ON DELETE CASCADE,
        action     TEXT NOT NULL CHECK (action IN ('created','cancelled','approved','rejected')),
        amount     INTEGER NOT NULL,
        note       TEXT NOT NULL DEFAULT '',
        actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        at         TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_advance_log_adv ON advance_log(advance_id);
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
