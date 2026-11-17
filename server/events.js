import { db, tx } from './db.js';
import { getSettings } from './settings.js';
import { addDays, dayStartMs, today as todayIn } from './time.js';
import { HttpError } from './util.js';

// Процент, который реально начисляется: 0, если «% с прибыли» выключен в схеме оплаты.
export const effectivePercent = (user) => (user.pay_percent === 0 ? 0 : user.percent);
// Оклад, который реально капает: 0, если «фикс» выключен.
export const effectiveRate = (user) => (user.pay_fixed === 0 ? 0 : user.daily_rate);

const money = (cents) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(cents / 100);

function profitToday(userId, tz) {
  const t = todayIn(tz);
  return db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM profit_events WHERE user_id = ? AND at >= ? AND at < ?')
    .get(userId, new Date(dayStartMs(t, tz)).toISOString(), new Date(dayStartMs(addDays(t, 1), tz)).toISOString()).s;
}

// Записывает поступление прибыли. Процент сотрудника фиксируется в момент записи.
// Если поступление закрыло дневную цель — сотруднику приходит уведомление.
export function addProfit({ user, amount, at, source, reading = null, page = '', note = '', clientId = null, createdBy = null, percent }) {
  const { tz } = getSettings();
  return tx(() => {
    if (clientId && db.prepare('SELECT id FROM profit_events WHERE client_id = ?').get(clientId)) {
      throw new HttpError(409, 'Эта запись уже получена');
    }
    const before = user.daily_goal > 0 ? profitToday(user.id, tz) : 0;
    const id = Number(
      db
        .prepare(
          `INSERT INTO profit_events (user_id, amount, percent, at, source, reading, page, note, client_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(user.id, amount, percent ?? effectivePercent(user), at, source, reading, page.slice(0, 300), note, clientId, createdBy).lastInsertRowid
    );
    if (user.daily_goal > 0 && amount > 0 && at.slice(0, 10) >= addDays(todayIn(tz), -1)) {
      const after = profitToday(user.id, tz);
      if (before < user.daily_goal && after >= user.daily_goal) {
        db.prepare("INSERT INTO notifications (kind, title, body, target_user_id) VALUES ('bonus', ?, ?, ?)").run(
          'Дневная цель выполнена 🎯',
          `Прибыль за сегодня — ${money(after)} сом при цели ${money(user.daily_goal)} сом. Отличная работа!`,
          user.id
        );
      }
    }
    return db.prepare('SELECT e.*, u.name AS user_name FROM profit_events e JOIN users u ON u.id = e.user_id WHERE e.id = ?').get(id);
  });
}

const dayProfit = (userId, date, tz) =>
  db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM profit_events WHERE user_id = ? AND at >= ? AND at < ?')
    .get(userId, new Date(dayStartMs(date, tz)).toISOString(), new Date(dayStartMs(addDays(date, 1), tz)).toISOString()).s;

// Заполнение прибыли за день: задаём итог за день. Разница записывается отдельным поступлением,
// день отмечается заполненным — после этого начисляется оклад за смену.
export function setDayProfit({ user, date, amount, note = '', source, by }) {
  const { tz } = getSettings();
  return tx(() => {
    const current = dayProfit(user.id, date, tz);
    const delta = amount - current;
    if (delta !== 0) {
      const t = todayIn(tz);
      const at = date === t ? new Date().toISOString() : new Date(Math.min(Date.now(), dayStartMs(date, tz) + 20 * 3600000)).toISOString();
      addProfit({ user, amount: delta, at, source, note: note || 'Прибыль за день', createdBy: by });
    }
    db.prepare(
      `INSERT INTO day_reports (user_id, date, filled_by) VALUES (?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET filled_by = excluded.filled_by, filled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run(user.id, date, by);
    return { date, profit: amount / 100, delta: delta / 100 };
  });
}
