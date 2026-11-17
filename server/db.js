import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { addDays, dayStartMs, dowOf, local, validTz } from './time.js';

export const db = new DatabaseSync(config.dbFile);

// WAL + synchronous=FULL: каждая подтверждённая транзакция гарантированно на диске.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

let txDepth = 0;
export function tx(fn) {
  // Вложенный вызов выполняется внутри уже открытой транзакции.
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  let ok = false;
  try {
    const result = fn();
    ok = true;
    return result;
  } finally {
    txDepth--;
    db.exec(ok ? 'COMMIT' : 'ROLLBACK');
  }
}

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// Закрытые смены (старая схема со сменами) переносятся в поступления вместе с заработанной по ним ставкой.
const V2_FROM_SHIFTS = `
      INSERT INTO profit_events (user_id, amount, percent, base_pay, at, source, note, created_by, created_at)
      SELECT user_id, profit, percent,
             shift_rate + CAST(ROUND((julianday(end_at) - julianday(start_at)) * 24 * hourly_rate) AS INTEGER),
             end_at, 'shift', note, created_by, created_at
      FROM shifts WHERE end_at IS NOT NULL AND profit IS NOT NULL;`;

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
      ${V2_FROM_SHIFTS}

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
  {
    // Оклад за смену начисляется только после того, как за день заполнена прибыль.
    // Отметка «прибыль за день заполнена» (в том числе нулевая).
    version: 5,
    name: 'day_reports',
    sql: `
      CREATE TABLE day_reports (
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date      TEXT NOT NULL,
        filled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        filled_at TEXT NOT NULL DEFAULT ${NOW},
        PRIMARY KEY (user_id, date)
      );
    `,
    // Уже прошедшие рабочие дни считаем заполненными — начисленное за прошлое не меняется.
    run: () => backfillDayReports(),
  },
];

function backfillDayReports() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tz'").get();
  const tz = row && validTz(row.value) ? row.value : 'Asia/Bishkek';
  const yesterday = addDays(local(Date.now(), tz).date, -1);
  const put = db.prepare('INSERT OR IGNORE INTO day_reports (user_id, date) VALUES (?, ?)');
  for (const u of db.prepare('SELECT id, work_days, pay_start FROM users WHERE pay_start IS NOT NULL').all()) {
    const over = new Map(db.prepare('SELECT date, kind FROM days_off WHERE user_id = ?').all(u.id).map((r) => [r.date, r.kind]));
    for (let d = u.pay_start; d <= yesterday; d = addDays(d, 1)) {
      const work = over.has(d) ? over.get(d) === 'work' : ((u.work_days >> dowOf(d)) & 1) === 1;
      if (work) put.run(u.id, d);
    }
  }
}

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT ${NOW}
  )`);
  const rows = db.prepare('SELECT version, name FROM schema_migrations').all();
  const applied = new Set(rows.map((r) => r.version));
  const fromSchedule = rows.some((r) => r.version === 2 && r.name === 'schedule');
  const pending = migrations.filter((m) => !applied.has(m.version));

  // Перед любым обновлением схемы существующей базы — отдельная копия, которую не удаляет ротация бэкапов.
  if ((pending.length || fromSchedule) && rows.length) {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const file = path.join(config.backupDir, `before-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    console.log(`[db] копия перед обновлением: ${path.basename(file)}`);
  }

  if (fromSchedule) {
    tx(() => convertFromSchedule());
    console.log('[db] данные версии «График» (workdays) перенесены в новую схему');
  }

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    tx(() => {
      db.exec(m.sql);
      m.run?.();
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

// База, созданная версией «График вместо открытия смен» (миграция 2_schedule, таблица workdays),
// переводится в схему «оклад в день + поступления прибыли» без потери данных:
//   • прошедшие смены → поступления (source='shift') вместе с заработанной ставкой за смену и часы,
//     так что начисленная за прошлое зарплата не меняется;
//   • запланированные смены → дни «смена» в графике, невыходы → «выходной» с причиной;
//   • оклад в день = ставка за смену + часы смены по умолчанию × ставка в час, капает с дня перехода;
//   • даты бонусов и штрафов снова хранятся как момент времени;
//   • сама таблица workdays не удаляется, а переименовывается в legacy_workdays.
function convertFromSchedule() {
  const v2 = migrations.find((m) => m.version === 2);
  db.exec(v2.sql.replace(V2_FROM_SHIFTS, ''));

  const envTz = (process.env.APP_TIMEZONE || '').trim();
  const tz = envTz && validTz(envTz) ? envTz : 'Asia/Bishkek';
  db.prepare("INSERT INTO settings (key, value) VALUES ('tz', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(tz);

  const toMin = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
  const span = (a, b) => {
    const m = toMin(b) - toMin(a);
    return m <= 0 ? m + 1440 : m;
  };
  const now = Date.now();
  const today = local(now, tz).date;
  const at = (date, startTime, minutes) => new Date(Math.min(now, dayStartMs(date, tz) + (toMin(startTime) + minutes) * 60000)).toISOString();

  // Ставки сотрудников: оклад в день из ставки за смену и почасовой ставки.
  const setUser = db.prepare('UPDATE users SET daily_rate = ?, work_days = 0, pay_start = ? WHERE id = ?');
  const setRate = db.prepare('INSERT OR REPLACE INTO rate_history (user_id, from_date, daily_rate) VALUES (?, ?, ?)');
  for (const u of db.prepare('SELECT * FROM users').all()) {
    const rate = u.shift_rate + Math.round((span(u.default_start || '10:00', u.default_end || '22:00') / 60) * u.hourly_rate);
    setUser.run(rate, today, u.id);
    setRate.run(u.id, '2000-01-01', rate);
  }

  const putDay = db.prepare(
    'INSERT INTO days_off (user_id, date, kind, note) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET kind = excluded.kind, note = excluded.note'
  );
  const putEvent = db.prepare(
    `INSERT INTO profit_events (user_id, amount, percent, base_pay, at, source, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'shift', ?, ?, ?)`
  );
  for (const d of db.prepare('SELECT * FROM workdays ORDER BY date, id').all()) {
    if (d.status === 'absent') {
      putDay.run(d.user_id, d.date, 'off', `Невыход${d.absence_reason ? `: ${d.absence_reason}` : ''}`.slice(0, 120));
      continue;
    }
    putDay.run(d.user_id, d.date, 'work', '');
    const minutes = span(d.start_time, d.end_time);
    const by = d.profit_by ?? d.created_by;
    if (d.date < today) {
      // Прошедшая смена: прибыль и заработанная ставка — одним поступлением в конце смены.
      const base = d.shift_rate + Math.round((minutes / 60) * d.hourly_rate);
      if (d.profit === null && base === 0) continue;
      putEvent.run(d.user_id, d.profit ?? 0, d.percent, base, at(d.date, d.start_time, minutes), d.note.slice(0, 500), by, d.created_at);
    } else if (d.profit !== null) {
      // Сегодня и позже: ставка капает по новой схеме, переносим только уже внесённую прибыль.
      putEvent.run(d.user_id, d.profit, d.percent, 0, d.profit_at || at(d.date, d.start_time, minutes), d.note.slice(0, 500), by, d.created_at);
    }
  }

  // Бонусы и штрафы: «ГГГГ-ММ-ДД» → полдень этого дня в часовом поясе компании.
  const updAdj = db.prepare('UPDATE adjustments SET date = ? WHERE id = ?');
  for (const a of db.prepare('SELECT id, date FROM adjustments').all()) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(a.date)) updAdj.run(new Date(dayStartMs(a.date, tz) + 12 * 3600000).toISOString(), a.id);
  }

  db.exec('ALTER TABLE workdays RENAME TO legacy_workdays');
  db.prepare("UPDATE schema_migrations SET name = 'daily_pay_and_profit_events_from_schedule' WHERE version = 2").run();
}
