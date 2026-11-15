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
