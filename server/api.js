import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from './config.js';
import { db, tx } from './db.js';
import {
  checkLogin,
  clearSessionCookie,
  hashPassword,
  loginLimiter,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from './auth.js';
import { snapshot } from './backup.js';
import {
  DAY_SQL,
  PROFIT_EDIT_DAYS,
  computeAnalytics,
  computeStats,
  employeePerms,
  publicAdjustment,
  publicDay,
  userSummary,
} from './stats.js';
import {
  HttpError,
  addDays,
  bad,
  daysBetween,
  fromCents,
  localNow,
  nowIso,
  parseRange,
  toCents,
  toDateKey,
  toId,
  toIdList,
  toNumber,
  toText,
  toTime,
  weekday,
} from './util.js';

export const api = Router();

// Защита от CSRF: изменяющие запросы принимаем только со своего origin.
api.use((req, res, next) => {
  const origin = req.get('origin');
  if (req.method !== 'GET' && origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== req.get('host')) throw new HttpError(403, 'Запрос с чужого сайта отклонён');
  }
  next();
});

function publicUser(u) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    role: u.role,
    active: Boolean(u.active),
    hourlyRate: fromCents(u.hourly_rate),
    shiftRate: fromCents(u.shift_rate),
    percent: u.percent,
    defaultStart: u.default_start,
    defaultEnd: u.default_end,
    createdAt: u.created_at,
  };
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
const getDay = (id) => db.prepare(`${DAY_SQL} WHERE w.id = ?`).get(id);

/* ---------- Авторизация ---------- */

api.post('/auth/login', async (req, res) => {
  const limiter = loginLimiter(req);
  const login = toText(req.body?.login, 'Логин', { min: 1, max: 64 });
  const password = String(req.body?.password ?? '');
  if (!password) throw bad('Введите пароль');
  const user = await checkLogin(login, password);
  if (!user) {
    limiter.fail();
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  if (!user.active) throw new HttpError(403, 'Учётная запись заблокирована. Обратитесь к администратору.');
  limiter.success();
  setSessionCookie(req, res, user);
  res.json(publicUser(user));
});

api.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.use(requireAuth);

api.get('/auth/me', (req, res) => res.json(publicUser(req.user)));

api.post('/auth/password', async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (!(await verifyPassword(current, req.user.password_hash))) throw bad('Текущий пароль указан неверно');
  if (next.length < 8) throw bad('Новый пароль должен быть не короче 8 символов');
  db.prepare(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?"
  ).run(await hashPassword(next), nowIso(), req.user.id);
  setSessionCookie(req, res, getUser(req.user.id));
  res.json({ ok: true });
});

/* ---------- График сотрудника ---------- */

const ABSENCE_REASON = { min: 2, max: 300 };

api.get('/me/schedule', (req, res) => {
  const { from, to } = parseRange(req.query);
  const now = localNow();
  const days = db.prepare(`${DAY_SQL} WHERE w.user_id = ? AND w.date >= ? AND w.date < ? ORDER BY w.date`).all(req.user.id, from, to);
  res.json({ now, days: days.map((d) => publicDay(d, now, true)) });
});

// Ближайшие дни: сегодняшняя смена, следующие смены и дни без внесённой прибыли.
api.get('/me/today', (req, res) => {
  const now = localNow();
  const rows = db
    .prepare(`${DAY_SQL} WHERE w.user_id = ? AND w.date >= ? AND w.date <= ? ORDER BY w.date`)
    .all(req.user.id, addDays(now.date, -PROFIT_EDIT_DAYS - 1), addDays(now.date, 60));
  const days = rows.map((d) => publicDay(d, now, true));
  // Ночная смена со вчерашнего дня ещё может идти — тогда показываем её как текущую.
  const current = days.find((d) => d.state === 'active') ?? days.find((d) => d.date === now.date) ?? null;
  res.json({
    now,
    current,
    upcoming: days.filter((d) => d.state === 'planned' && d !== current).slice(0, 5),
    needsProfit: days.filter((d) => d.state === 'needs_profit' && d.canEditProfit && d !== current),
  });
});

function ownDay(req) {
  const d = getDay(toId(req.params.id, 'Смена не найдена'));
  if (!d || d.user_id !== req.user.id) throw new HttpError(404, 'Смена не найдена');
  return d;
}

function sendOwnDay(res, id) {
  res.json(publicDay(getDay(id), localNow(), true));
}

api.put('/me/days/:id/profit', (req, res) => {
  const profit = toCents(req.body?.profit, 'Прибыль за смену');
  const note = toText(req.body?.note, 'Комментарий', { max: 500 });
  const id = tx(() => {
    const d = ownDay(req);
    if (!employeePerms(d, req.user.id, localNow()).canEditProfit) {
      throw new HttpError(403, d.status === 'absent' ? 'В этот день отмечен невыход' : 'Прибыль за этот день может изменить только администратор');
    }
    db.prepare('UPDATE workdays SET profit = ?, note = ?, profit_by = ?, profit_at = ?, updated_at = ? WHERE id = ?').run(
      profit, note, req.user.id, nowIso(), nowIso(), d.id
    );
    return d.id;
  });
  sendOwnDay(res, id);
});

api.post('/me/days/:id/absence', (req, res) => {
  const reason = toText(req.body?.reason, 'Причина', ABSENCE_REASON);
  const id = tx(() => {
    const d = ownDay(req);
    if (!employeePerms(d, req.user.id, localNow()).canMarkAbsent) {
      throw new HttpError(409, d.status === 'absent' ? 'Невыход уже отмечен' : 'По этой смене уже внесена прибыль');
    }
    db.prepare(
      `UPDATE workdays SET status = 'absent', absence_reason = ?, absence_by = ?, absence_at = ?, updated_at = ? WHERE id = ?`
    ).run(reason, req.user.id, nowIso(), nowIso(), d.id);
    return d.id;
  });
  sendOwnDay(res, id);
});

api.delete('/me/days/:id/absence', (req, res) => {
  const id = tx(() => {
    const d = ownDay(req);
    if (!employeePerms(d, req.user.id, localNow()).canUnmarkAbsent) {
      throw new HttpError(403, 'Снять эту отметку может только администратор');
    }
    db.prepare(
      `UPDATE workdays SET status = 'work', absence_reason = '', absence_by = NULL, absence_at = NULL, updated_at = ? WHERE id = ?`
    ).run(nowIso(), d.id);
    return d.id;
  });
  sendOwnDay(res, id);
});

/* ---------- Статистика ---------- */

api.get('/me/summary', (req, res) => {
  const range = parseRange(req.query);
  res.json({ user: publicUser(req.user), ...userSummary(req.user.id, range) });
});

api.get('/stats/overview', (req, res) => {
  const stats = computeStats(parseRange(req.query), { withPay: false });
  const place = stats.leaderboard.findIndex((r) => r.userId === req.user.id);
  res.json({ ...stats, myPlace: place >= 0 ? place + 1 : null });
});

/* ---------- Уведомления ---------- */

const VISIBLE_NOTIFICATIONS = `
  FROM notifications n
  LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
  WHERE (n.target_user_id IS NULL OR n.target_user_id = ?) AND n.created_at >= ?`;

function publicNotification(n) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    paydayDate: n.payday_date,
    targetUserId: n.target_user_id,
    targetName: n.target_name ?? null,
    createdAt: n.created_at,
    read: n.read_at ? true : false,
    reads: n.reads,
    recipients: n.recipients,
  };
}

api.get('/notifications', (req, res) => {
  const u = req.user;
  const items = db
    .prepare(`SELECT n.*, r.read_at ${VISIBLE_NOTIFICATIONS} ORDER BY n.created_at DESC LIMIT 100`)
    .all(u.id, u.id, u.created_at);
  const { unread } = db
    .prepare(`SELECT COUNT(*) AS unread ${VISIBLE_NOTIFICATIONS} AND r.read_at IS NULL`)
    .get(u.id, u.id, u.created_at);
  res.json({ unread, items: items.map(publicNotification) });
});

api.post('/notifications/read-all', (req, res) => {
  const u = req.user;
  db.prepare(
    `INSERT OR IGNORE INTO notification_reads (notification_id, user_id)
     SELECT n.id, ? ${VISIBLE_NOTIFICATIONS} AND r.read_at IS NULL`
  ).run(u.id, u.id, u.id, u.created_at);
  res.json({ ok: true });
});

/* ======================= Администратор ======================= */

const admin = Router();
api.use('/admin', requireAdmin, admin);

/* ---------- Сотрудники ---------- */

function readRates(body, current) {
  return {
    hourly_rate:
      body.hourlyRate !== undefined
        ? toCents(body.hourlyRate, 'Ставка в час', { min: 0, max: 1e7 })
        : (current?.hourly_rate ?? 0),
    shift_rate:
      body.shiftRate !== undefined
        ? toCents(body.shiftRate, 'Ставка за смену', { min: 0, max: 1e8 })
        : (current?.shift_rate ?? 0),
    percent: body.percent !== undefined ? toNumber(body.percent, 'Процент от прибыли', { max: 100 }) : (current?.percent ?? 0),
  };
}

function readLogin(v) {
  const login = toText(v, 'Логин', { min: 3, max: 32 });
  if (!/^[a-zA-Z0-9._-]+$/.test(login)) throw bad('Логин: только латиница, цифры, точка, дефис и подчёркивание');
  return login;
}

function assertLoginFree(login, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM users WHERE login = ? AND id != ?').get(login, exceptId)) {
    throw new HttpError(409, 'Такой логин уже занят');
  }
}

function activeAdminsExcept(id) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?")
    .get(id).c;
}

admin.get('/users', (req, res) => {
  const now = localNow();
  const rows = db
    .prepare(`SELECT u.* FROM users u WHERE u.deleted_at IS NULL ORDER BY u.role = 'admin', u.name COLLATE NOCASE`)
    .all();
  const today = new Map(db.prepare(`${DAY_SQL} WHERE w.date = ?`).all(now.date).map((d) => [d.user_id, publicDay(d, now)]));
  const next = new Map(
    db
      .prepare(`SELECT user_id, MIN(date) AS date FROM workdays WHERE date > ? AND status = 'work' GROUP BY user_id`)
      .all(now.date)
      .map((r) => [r.user_id, r.date])
  );
  res.json(rows.map((u) => ({ ...publicUser(u), today: today.get(u.id) ?? null, nextDate: next.get(u.id) ?? null })));
});

function readDefaults(body, current) {
  return {
    default_start: body.defaultStart !== undefined ? toTime(body.defaultStart, 'Начало смены') : (current?.default_start ?? '10:00'),
    default_end: body.defaultEnd !== undefined ? toTime(body.defaultEnd, 'Конец смены') : (current?.default_end ?? '22:00'),
  };
}

admin.post('/users', async (req, res) => {
  const b = req.body ?? {};
  const login = readLogin(b.login);
  const name = toText(b.name, 'Имя', { min: 1, max: 80 });
  const password = String(b.password ?? '');
  if (password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  const role = b.role === 'admin' ? 'admin' : 'operator';
  const rates = readRates(b);
  const defaults = readDefaults(b);
  assertLoginFree(login);
  const hash = await hashPassword(password);
  const r = db
    .prepare(
      `INSERT INTO users (login, name, password_hash, role, hourly_rate, shift_rate, percent, default_start, default_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(login, name, hash, role, rates.hourly_rate, rates.shift_rate, rates.percent, defaults.default_start, defaults.default_end);
  res.status(201).json(publicUser(getUser(Number(r.lastInsertRowid))));
});

admin.put('/users/:id', async (req, res) => {
  const id = toId(req.params.id);
  const u = getUser(id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  const b = req.body ?? {};
  const login = b.login !== undefined ? readLogin(b.login) : u.login;
  const name = b.name !== undefined ? toText(b.name, 'Имя', { min: 1, max: 80 }) : u.name;
  const role = b.role === undefined ? u.role : b.role === 'admin' ? 'admin' : 'operator';
  const active = b.active === undefined ? u.active : b.active ? 1 : 0;
  const rates = readRates(b, u);
  const defaults = readDefaults(b, u);
  const password = b.password ? String(b.password) : '';
  if (password && password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  if (id === req.user.id && (role !== 'admin' || !active)) {
    throw bad('Нельзя снять с себя права администратора или заблокировать себя');
  }
  if (u.role === 'admin' && (role !== 'admin' || !active) && activeAdminsExcept(id) === 0) {
    throw bad('Должен остаться хотя бы один активный администратор');
  }
  assertLoginFree(login, id);
  const hash = password ? await hashPassword(password) : u.password_hash;
  const bump = password || !active || role !== u.role ? 1 : 0;
  const ratesChanged = rates.hourly_rate !== u.hourly_rate || rates.shift_rate !== u.shift_rate || rates.percent !== u.percent;
  tx(() => {
    db.prepare(
      `UPDATE users SET login = ?, name = ?, role = ?, active = ?, password_hash = ?, hourly_rate = ?, shift_rate = ?,
         percent = ?, default_start = ?, default_end = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?`
    ).run(login, name, role, active, hash, rates.hourly_rate, rates.shift_rate, rates.percent, defaults.default_start,
      defaults.default_end, bump, nowIso(), id);
    // Новые ставки действуют с сегодняшнего дня; прошедшие смены не пересчитываются.
    if (ratesChanged) {
      db.prepare('UPDATE workdays SET hourly_rate = ?, shift_rate = ?, percent = ?, updated_at = ? WHERE user_id = ? AND date >= ?').run(
        rates.hourly_rate, rates.shift_rate, rates.percent, nowIso(), id, localNow().date
      );
    }
  });
  res.json(publicUser(getUser(id)));
});

// Удаление «мягкое»: история смен и выплат сохраняется для статистики, будущий график удаляется.
admin.delete('/users/:id', (req, res) => {
  const id = toId(req.params.id);
  if (id === req.user.id) throw bad('Нельзя удалить свою учётную запись');
  const u = getUser(id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (u.role === 'admin' && activeAdminsExcept(id) === 0) throw bad('Должен остаться хотя бы один администратор');
  tx(() => {
    db.prepare(
      `UPDATE users SET deleted_at = ?, active = 0, login = login || '#deleted-' || id,
         token_version = token_version + 1, updated_at = ? WHERE id = ?`
    ).run(nowIso(), nowIso(), id);
    db.prepare('DELETE FROM workdays WHERE user_id = ? AND date > ? AND profit IS NULL').run(id, localNow().date);
  });
  res.json({ ok: true });
});

/* ---------- График ---------- */

admin.get('/schedule', (req, res) => {
  const { from, to } = parseRange(req.query);
  const now = localNow();
  const users = db
    .prepare(
      `SELECT * FROM users WHERE role = 'operator' AND (deleted_at IS NULL OR id IN
         (SELECT user_id FROM workdays WHERE date >= ? AND date < ?))
       ORDER BY deleted_at IS NOT NULL, active DESC, name COLLATE NOCASE`
    )
    .all(from, to);
  const days = db.prepare(`${DAY_SQL} WHERE w.date >= ? AND w.date < ? ORDER BY w.date`).all(from, to);
  res.json({
    now,
    users: users.map((u) => ({ ...publicUser(u), deleted: Boolean(u.deleted_at) })),
    days: days.map((d) => publicDay(d, now)),
  });
});

function operatorOrFail(id) {
  const u = getUser(id);
  if (!u || u.role !== 'operator') throw bad('Сотрудник не найден');
  return u;
}

function uniqueDayGuard(fn) {
  try {
    return fn();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'У сотрудника уже есть смена в этот день');
    throw e;
  }
}

// Невыход, отмеченный администратором, приходит сотруднику уведомлением.
function notifyAbsence(day, adminId) {
  const when = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  db.prepare('INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES (?, ?, ?, ?, ?)').run(
    'info',
    `Отмечен невыход ${when}`,
    day.absence_reason,
    day.user_id,
    adminId
  );
}

// Создание или правка дня администратором: время, прибыль, невыход, ставки.
function readDay(b, current) {
  const user = current ? null : operatorOrFail(toId(b.userId, 'Выберите сотрудника'));
  const status = b.status !== undefined ? (b.status === 'absent' ? 'absent' : 'work') : (current?.status ?? 'work');
  const d = {
    user_id: current ? current.user_id : user.id,
    date: b.date !== undefined || !current ? toDateKey(b.date, 'Дата') : current.date,
    start_time: b.startTime !== undefined ? toTime(b.startTime, 'Начало') : (current?.start_time ?? user.default_start),
    end_time: b.endTime !== undefined ? toTime(b.endTime, 'Конец') : (current?.end_time ?? user.default_end),
    status,
    note: b.note !== undefined ? toText(b.note, 'Комментарий', { max: 500 }) : (current?.note ?? ''),
    ...readRates(b, current ?? user),
  };
  if (status === 'absent') {
    d.profit = null;
    d.absence_reason =
      b.absenceReason !== undefined ? toText(b.absenceReason, 'Причина', ABSENCE_REASON) : current?.absence_reason || '';
    if (!d.absence_reason) throw bad('Укажите причину невыхода');
  } else {
    d.profit = b.profit !== undefined ? toCents(b.profit, 'Прибыль', { required: false }) : (current?.profit ?? null);
    d.absence_reason = '';
  }
  return d;
}

admin.post('/days', (req, res) => {
  const d = readDay(req.body ?? {});
  const now = nowIso();
  const absent = d.status === 'absent';
  const id = tx(() => {
    const id = uniqueDayGuard(
      () =>
        db
          .prepare(
            `INSERT INTO workdays (user_id, date, start_time, end_time, status, absence_reason, absence_by, absence_at,
               profit, profit_by, profit_at, hourly_rate, shift_rate, percent, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            d.user_id,
            d.date,
            d.start_time,
            d.end_time,
            d.status,
            d.absence_reason,
            absent ? req.user.id : null,
            absent ? now : null,
            d.profit,
            d.profit === null ? null : req.user.id,
            d.profit === null ? null : now,
            d.hourly_rate,
            d.shift_rate,
            d.percent,
            d.note,
            req.user.id
          ).lastInsertRowid
    );
    if (absent) notifyAbsence(d, req.user.id);
    return Number(id);
  });
  res.status(201).json(publicDay(getDay(id), localNow()));
});

admin.put('/days/:id', (req, res) => {
  const id = toId(req.params.id);
  tx(() => {
    const current = getDay(id);
    if (!current) throw new HttpError(404, 'Смена не найдена');
    const d = readDay(req.body ?? {}, current);
    const now = nowIso();
    const absent = d.status === 'absent';
    const becameAbsent = absent && current.status !== 'absent';
    const absenceChanged = becameAbsent || (absent && d.absence_reason !== current.absence_reason);
    const profitChanged = d.profit !== current.profit;
    uniqueDayGuard(() =>
      db
        .prepare(
          `UPDATE workdays SET date = ?, start_time = ?, end_time = ?, status = ?, absence_reason = ?,
             absence_by = ?, absence_at = ?, profit = ?, profit_by = ?, profit_at = ?,
             hourly_rate = ?, shift_rate = ?, percent = ?, note = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          d.date,
          d.start_time,
          d.end_time,
          d.status,
          d.absence_reason,
          absent ? (absenceChanged ? req.user.id : current.absence_by) : null,
          absent ? (absenceChanged ? now : current.absence_at) : null,
          d.profit,
          d.profit === null ? null : profitChanged ? req.user.id : current.profit_by,
          d.profit === null ? null : profitChanged ? now : current.profit_at,
          d.hourly_rate,
          d.shift_rate,
          d.percent,
          d.note,
          now,
          id
        )
    );
    if (becameAbsent) notifyAbsence(d, req.user.id);
  });
  res.json(publicDay(getDay(id), localNow()));
});

admin.delete('/days/:id', (req, res) => {
  const r = db.prepare('DELETE FROM workdays WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Смена не найдена');
  res.json({ ok: true });
});

function readFillRange(b) {
  const from = toDateKey(b.from, 'С даты');
  const to = toDateKey(b.to, 'По дату');
  if (to < from) throw bad('Дата окончания раньше даты начала');
  if (daysBetween(from, to) > 370) throw bad('Заполнять можно не больше чем на год');
  return { from, to };
}

// Заполнение графика по шаблону: дни недели или «N через M».
admin.post('/schedule/fill', (req, res) => {
  const b = req.body ?? {};
  const users = toIdList(b.userIds, 'сотрудников').map(operatorOrFail);
  const { from, to } = readFillRange(b);
  let isWork;
  if (b.pattern === 'cycle') {
    const work = toNumber(b.cycleWork, 'Рабочих дней', { min: 1, max: 14, integer: true });
    const off = toNumber(b.cycleOff, 'Выходных дней', { min: 1, max: 14, integer: true });
    isWork = (key) => daysBetween(from, key) % (work + off) < work;
  } else {
    const set = new Set((Array.isArray(b.weekdays) ? b.weekdays : []).map(Number).filter((n) => n >= 0 && n <= 6));
    if (!set.size) throw bad('Выберите хотя бы один день недели');
    isWork = (key) => set.has(weekday(key));
  }
  const ownTimes = !b.startTime && !b.endTime;
  const st = ownTimes ? null : toTime(b.startTime, 'Начало');
  const et = ownTimes ? null : toTime(b.endTime, 'Конец');
  const replace = Boolean(b.replace);
  const today = localNow().date;
  const result = { added: 0, updated: 0, removed: 0 };

  tx(() => {
    const ins = db.prepare(
      `INSERT INTO workdays (user_id, date, start_time, end_time, hourly_rate, shift_rate, percent, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const upd = db.prepare('UPDATE workdays SET start_time = ?, end_time = ?, updated_at = ? WHERE id = ?');
    const del = db.prepare('DELETE FROM workdays WHERE id = ?');
    for (const u of users) {
      const start = st ?? u.default_start;
      const end = et ?? u.default_end;
      const existing = new Map(
        db
          .prepare('SELECT * FROM workdays WHERE user_id = ? AND date >= ? AND date <= ?')
          .all(u.id, from, to)
          .map((d) => [d.date, d])
      );
      for (let key = from; key <= to; key = addDays(key, 1)) {
        const ex = existing.get(key);
        // Заменять можно только сегодняшние и будущие дни без прибыли и без отметки о невыходе.
        const replaceable = replace && ex && key >= today && ex.status === 'work' && ex.profit === null;
        if (isWork(key)) {
          if (!ex) {
            ins.run(u.id, key, start, end, u.hourly_rate, u.shift_rate, u.percent, req.user.id);
            result.added++;
          } else if (replaceable && (ex.start_time !== start || ex.end_time !== end)) {
            upd.run(start, end, nowIso(), ex.id);
            result.updated++;
          }
        } else if (replaceable) {
          del.run(ex.id);
          result.removed++;
        }
      }
    }
  });
  res.json(result);
});

// Очистка графика: удаляются только сегодняшние и будущие дни без внесённой прибыли.
admin.post('/schedule/clear', (req, res) => {
  const b = req.body ?? {};
  const ids = toIdList(b.userIds, 'сотрудников');
  const { from, to } = readFillRange(b);
  const today = localNow().date;
  const start = from > today ? from : today;
  let removed = 0;
  tx(() => {
    const del = db.prepare('DELETE FROM workdays WHERE user_id = ? AND date >= ? AND date <= ? AND profit IS NULL');
    for (const id of ids) removed += del.run(id, start, to).changes;
  });
  res.json({ removed });
});

/* ---------- Бонусы и штрафы ---------- */

const KIND_TITLE = { bonus: 'Начислен бонус', fine: 'Назначен штраф' };

function readAdjustment(b, current) {
  const userId = current ? current.user_id : toId(b.userId, 'Выберите сотрудника');
  if (!current && !getUser(userId)) throw bad('Сотрудник не найден');
  const kind = b.kind ?? current?.kind;
  if (kind !== 'bonus' && kind !== 'fine') throw bad('Тип: бонус или штраф');
  return {
    user_id: userId,
    kind,
    amount: b.amount !== undefined ? toCents(b.amount, 'Сумма', { min: 0.01, max: 1e8 }) : current.amount,
    reason: b.reason !== undefined ? toText(b.reason, 'Причина', { max: 300 }) : current.reason,
    date: b.date !== undefined ? toDateKey(b.date, 'Дата') : current.date,
  };
}

admin.get('/adjustments', (req, res) => {
  const { from, to } = parseRange(req.query);
  const params = [from, to];
  let sql = `SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id
             WHERE a.date >= ? AND a.date < ?`;
  if (req.query.userId) {
    sql += ' AND a.user_id = ?';
    params.push(toId(req.query.userId));
  }
  res.json(db.prepare(`${sql} ORDER BY a.date DESC, a.id DESC LIMIT 2000`).all(...params).map(publicAdjustment));
});

admin.post('/adjustments', (req, res) => {
  const a = readAdjustment(req.body ?? {});
  const row = tx(() => {
    const id = db
      .prepare('INSERT INTO adjustments (user_id, kind, amount, reason, date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a.user_id, a.kind, a.amount, a.reason, a.date, req.user.id).lastInsertRowid;
    if (req.body?.notify !== false) {
      const sum = new Intl.NumberFormat('ru-RU').format(fromCents(a.amount));
      db.prepare(
        'INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES (?, ?, ?, ?, ?)'
      ).run(a.kind, `${KIND_TITLE[a.kind]}: ${sum} сом`, a.reason, a.user_id, req.user.id);
    }
    return db
      .prepare('SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id WHERE a.id = ?')
      .get(Number(id));
  });
  res.status(201).json(publicAdjustment(row));
});

admin.put('/adjustments/:id', (req, res) => {
  const id = toId(req.params.id);
  const current = db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Запись не найдена');
  const a = readAdjustment(req.body ?? {}, current);
  db.prepare('UPDATE adjustments SET kind = ?, amount = ?, reason = ?, date = ? WHERE id = ?').run(
    a.kind,
    a.amount,
    a.reason,
    a.date,
    id
  );
  res.json(
    publicAdjustment(
      db.prepare('SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(id)
    )
  );
});

admin.delete('/adjustments/:id', (req, res) => {
  const r = db.prepare('DELETE FROM adjustments WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Запись не найдена');
  res.json({ ok: true });
});

/* ---------- Рассылка уведомлений ---------- */

admin.get('/notifications', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.*, t.name AS target_name,
         (SELECT COUNT(*) FROM notification_reads r WHERE r.notification_id = n.id) AS reads,
         CASE WHEN n.target_user_id IS NULL THEN
           (SELECT COUNT(*) FROM users u WHERE u.role = 'operator' AND u.deleted_at IS NULL AND u.active = 1 AND u.created_at <= n.created_at)
         ELSE 1 END AS recipients
       FROM notifications n LEFT JOIN users t ON t.id = n.target_user_id
       ORDER BY n.created_at DESC LIMIT 200`
    )
    .all();
  res.json(rows.map(publicNotification));
});

admin.post('/notifications', (req, res) => {
  const b = req.body ?? {};
  const kind = b.kind === 'payday' ? 'payday' : 'info';
  const title = toText(b.title, 'Заголовок', { min: 1, max: 120 });
  const body = toText(b.body, 'Текст', { max: 2000 });
  let paydayDate = null;
  if (kind === 'payday') {
    paydayDate = toText(b.paydayDate, 'Дата выдачи зарплаты', { min: 1, max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paydayDate)) throw bad('Дата выдачи зарплаты: формат ГГГГ-ММ-ДД');
  }
  let target = null;
  if (b.targetUserId) {
    target = toId(b.targetUserId, 'Получатель не найден');
    if (!getUser(target)) throw bad('Получатель не найден');
  }
  const id = db
    .prepare(
      'INSERT INTO notifications (kind, title, body, payday_date, target_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(kind, title, body, paydayDate, target, req.user.id).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

admin.delete('/notifications/:id', (req, res) => {
  const r = db.prepare('DELETE FROM notifications WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Уведомление не найдено');
  res.json({ ok: true });
});

/* ---------- Статистика и резервные копии ---------- */

// Главный экран администратора: кто сегодня по графику, кто не вышел, где не внесена прибыль.
admin.get('/today', (req, res) => {
  const now = localNow();
  const today = db
    .prepare(`${DAY_SQL} WHERE w.date >= ? AND w.date <= ? ORDER BY w.start_time, u.name COLLATE NOCASE`)
    .all(addDays(now.date, -1), now.date)
    .map((d) => publicDay(d, now))
    // Вчерашние смены показываем, только если ночная смена ещё идёт.
    .filter((d) => d.date === now.date || d.state === 'active');
  const missing = db
    .prepare(`${DAY_SQL} WHERE w.date >= ? AND w.date <= ? AND w.status = 'work' AND w.profit IS NULL ORDER BY w.date DESC`)
    .all(addDays(now.date, -30), now.date)
    .map((d) => publicDay(d, now))
    .filter((d) => d.state === 'needs_profit');
  const absences = db
    .prepare(`${DAY_SQL} WHERE w.status = 'absent' AND w.date >= ? AND w.date <= ? ORDER BY w.date DESC`)
    .all(addDays(now.date, -7), addDays(now.date, 14))
    .map((d) => publicDay(d, now));
  res.json({ now, today, missing, absences });
});

admin.get('/stats', (req, res) => {
  res.json(computeStats(parseRange(req.query), { withPay: true }));
});

admin.get('/analytics', (req, res) => {
  res.json(computeAnalytics(parseRange(req.query)));
});

admin.get('/backup', (req, res) => {
  const file = path.join(config.dataDir, `download-${Date.now()}.db`);
  snapshot(file);
  const name = `smeny-backup-${new Date().toISOString().slice(0, 10)}.db`;
  res.download(file, name, () => fs.rm(file, { force: true }, () => {}));
});

api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
