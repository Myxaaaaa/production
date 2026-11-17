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
import { computeAnalytics, computeLive, publicEvent, recentEvents, todayFor } from './analytics.js';
import { balanceFor, exportPay, payrollFor, scheduleFor } from './payroll.js';
import { computeMoney, computeRating, streakFor } from './rating.js';
import { addProfit, effectivePercent, effectiveRate, setDayProfit } from './events.js';
import { getSettings, setSettings } from './settings.js';
import { PAY_MODES, parseDates, paydayInfo } from './payday.js';
import { addDays, dayStartMs, daysBetween, isDate, today as todayIn, validTz } from './time.js';
import { HttpError, bad, fromCents, nowIso, toCents, toIso, toId, toNumber, toText } from './util.js';

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

const tz = () => getSettings().tz;
const today = () => todayIn(tz());

function publicUser(u) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    role: u.role,
    active: Boolean(u.active),
    dailyRate: fromCents(u.daily_rate),
    percent: u.percent,
    payFixed: u.pay_fixed !== 0,
    payPercent: u.pay_percent !== 0,
    workDays: u.work_days,
    payStart: u.pay_start,
    dailyGoal: fromCents(u.daily_goal),
    createdAt: u.created_at,
  };
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
const getEvent = (id) =>
  db.prepare('SELECT e.*, u.name AS user_name FROM profit_events e JOIN users u ON u.id = e.user_id WHERE e.id = ?').get(id);

// Период: from/to — локальные даты ГГГГ-ММ-ДД включительно. По умолчанию — текущий месяц.
function parseDays(q) {
  const t = today();
  const from = q.from ? String(q.from) : `${t.slice(0, 8)}01`;
  const to = q.to ? String(q.to) : t;
  if (!isDate(from) || !isDate(to)) throw bad('Неверный период');
  if (from > to) throw bad('Начало периода позже конца');
  if (daysBetween(from, to) > 3700) throw bad('Слишком длинный период');
  return { from, to };
}

function csv(res, name, header, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const num = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : v);
  const body = [header, ...rows].map((r) => r.map((v) => esc(num(v))).join(';')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${body}`);
}

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
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(
    await hashPassword(next),
    nowIso(),
    req.user.id
  );
  setSessionCookie(req, res, getUser(req.user.id));
  res.json({ ok: true });
});

/* ---------- Сотрудник ---------- */

api.get('/me/home', (req, res) => {
  const u = req.user;
  const b = balanceFor(u);
  const t = today();
  const week = payrollFor(u, addDays(t, -6), t);
  const month = payrollFor(u, `${t.slice(0, 8)}01`, t);
  res.json({
    user: publicUser(u),
    tz: tz(),
    today: todayFor(u),
    week: exportPay(week),
    month: exportPay(month),
    balance: { accrued: fromCents(b.accrued), paid: fromCents(b.paid), balance: fromCents(b.balance) },
    lastPayout: (() => {
      const p = db.prepare('SELECT amount, date FROM payouts WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(u.id);
      return p ? { amount: fromCents(p.amount), date: p.date } : null;
    })(),
    events: recentEvents({ userId: u.id, limit: 15 }),
    streak: streakFor(u.id),
    payday: (() => {
      const p = paydayInfo(1);
      return { text: p.text, next: p.next[0] ?? null };
    })(),
  });
});

api.get('/me/payroll', (req, res) => {
  const { from, to } = parseDays(req.query);
  const u = req.user;
  const p = exportPay(payrollFor(u, from, to, { breakdown: true }));
  const adjustments = db
    .prepare('SELECT * FROM adjustments WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date DESC')
    .all(u.id, new Date(dayStartMs(from, tz())).toISOString(), new Date(dayStartMs(addDays(to, 1), tz())).toISOString());
  const payouts = db.prepare('SELECT * FROM payouts WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC').all(u.id, from, to);
  const corrections = db
    .prepare('SELECT * FROM salary_corrections WHERE user_id = ? AND date >= ? AND date < ? ORDER BY date DESC')
    .all(u.id, new Date(dayStartMs(from, tz())).toISOString(), new Date(dayStartMs(addDays(to, 1), tz())).toISOString())
    .map((c) => ({ id: c.id, amount: fromCents(c.amount), reason: c.reason, date: c.date }));
  const b = balanceFor(u);
  res.json({
    user: publicUser(u),
    range: { from, to },
    totals: p,
    balance: fromCents(b.balance),
    adjustments: adjustments.map(publicAdjustment),
    payouts: payouts.map(publicPayout),
    corrections,
  });
});

api.get('/me/analytics', (req, res) => {
  const range = parseDays(req.query);
  const mine = computeAnalytics({ ...range, userId: req.user.id, windowHours: req.query.w });
  const team = computeAnalytics({ ...range, windowHours: req.query.w });
  const operators = db.prepare("SELECT id, name FROM users WHERE role = 'operator' AND deleted_at IS NULL AND active = 1").all();
  const board = operators
    .map((o) => team.leaderboard.find((r) => r.userId === o.id) || { userId: o.id, name: o.name, profit: 0, events: 0, activeHours: 0, perHour: 0, share: 0 })
    .sort((a, b) => b.profit - a.profit)
    .map(({ window, bestHour, ...r }) => r);
  const place = board.findIndex((r) => r.userId === req.user.id);
  res.json({ ...mine, team: { totals: team.totals, window: team.window, leaderboard: board }, myPlace: place >= 0 ? place + 1 : null });
});

api.get('/me/schedule', (req, res) => {
  const { from, to } = parseDays(req.query);
  res.json({ user: publicUser(req.user), ...scheduleFor(req.user, from, to) });
});

// Сотрудник видит рейтинг КПД команды без денежных данных о зарплатах коллег.
api.get('/me/rating', (req, res) => {
  const r = computeRating(parseDays(req.query), { forOperator: true });
  res.json({ ...r, meId: req.user.id });
});

api.get('/me/events', (req, res) => {
  const { from, to } = parseDays(req.query);
  res.json(listEvents({ from, to, userId: req.user.id }));
});

api.post('/me/profit', (req, res) => {
  const amount = toCents(req.body?.amount, 'Сумма', { min: -1e8, max: 1e8 });
  if (amount === 0) throw bad('Сумма не может быть нулевой');
  const note = toText(req.body?.note, 'Комментарий', { max: 200 });
  const e = addProfit({ user: req.user, amount, at: nowIso(), source: 'manual', note, createdBy: req.user.id });
  res.status(201).json(publicEvent(e));
});

// Сотрудник заполняет прибыль за свою смену (сегодня или за последние 7 дней) — после этого начисляется оклад.
api.put('/me/day-profit', (req, res) => {
  const b = req.body ?? {};
  const t = today();
  const date = b.date || t;
  if (!isDate(date)) throw bad('Неверная дата');
  if (date > t) throw bad('Нельзя заполнить прибыль за будущий день');
  if (date < addDays(t, -7)) throw bad('Прибыль старше недели заполняет администратор');
  const amount = toCents(b.amount, 'Прибыль', { min: 0, max: 1e10 });
  const note = toText(b.note, 'Комментарий', { max: 200 });
  res.json(setDayProfit({ user: req.user, date, amount, note, source: 'manual', by: req.user.id }));
});

// Сотрудник может отменить свою ручную запись в течение 15 минут.
api.delete('/me/profit/:id', (req, res) => {
  const e = getEvent(toId(req.params.id));
  if (!e || e.user_id !== req.user.id) throw new HttpError(404, 'Запись не найдена');
  if (e.source !== 'manual' || Date.now() - Date.parse(e.created_at) > 15 * 60000) {
    throw new HttpError(403, 'Отменить можно только свою ручную запись в течение 15 минут');
  }
  db.prepare('DELETE FROM profit_events WHERE id = ?').run(e.id);
  res.json({ ok: true });
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
  const { unread } = db.prepare(`SELECT COUNT(*) AS unread ${VISIBLE_NOTIFICATIONS} AND r.read_at IS NULL`).get(u.id, u.id, u.created_at);
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

/* ---------- Настройки ---------- */

function publicSettings(s) {
  return { tz: s.tz, teamDailyGoal: fromCents(s.teamDailyGoal), windowHours: s.windowHours };
}

admin.get('/settings', (req, res) => res.json(publicSettings(getSettings())));

admin.put('/settings', (req, res) => {
  const b = req.body ?? {};
  const patch = {};
  if (b.tz !== undefined) {
    if (!validTz(String(b.tz))) throw bad('Неизвестный часовой пояс');
    patch.tz = String(b.tz);
  }
  if (b.teamDailyGoal !== undefined) patch.teamDailyGoal = toCents(b.teamDailyGoal, 'Цель команды', { min: 0, max: 1e10 });
  if (b.windowHours !== undefined) patch.windowHours = toNumber(b.windowHours, 'Окно, часов', { min: 1, max: 8 });
  res.json(publicSettings(setSettings(patch)));
});

// Режим выдачи зарплаты.
admin.get('/payday', (req, res) => res.json(paydayInfo()));

admin.put('/payday', (req, res) => {
  const b = req.body ?? {};
  if (!PAY_MODES.includes(b.mode)) throw bad('Выберите режим выдачи');
  const patch = { payMode: b.mode };
  if (b.weekday !== undefined) patch.payWeekday = toNumber(b.weekday, 'День недели', { min: 0, max: 6 }) | 0;
  if (b.monthDay !== undefined) patch.payMonthDay = toNumber(b.monthDay, 'Число месяца', { min: 1, max: 31 }) | 0;
  if (b.monthDay2 !== undefined) patch.payMonthDay2 = toNumber(b.monthDay2, 'Второе число', { min: 1, max: 31 }) | 0;
  if (b.dates !== undefined) {
    const dates = parseDates(Array.isArray(b.dates) ? b.dates.join(',') : b.dates);
    if (dates.length > 366) throw bad('Слишком много дат');
    patch.payDates = dates.join(',');
  }
  if (b.mode === 'dates' && !(patch.payDates ?? getSettings().payDates)) throw bad('Отметьте в календаре хотя бы один день выдачи');
  setSettings(patch);
  res.json(paydayInfo());
});

/* ---------- Сотрудники ---------- */

function readLogin(v) {
  const login = toText(v, 'Логин', { min: 3, max: 32 });
  if (!/^[a-zA-Z0-9._-]+$/.test(login)) throw bad('Логин: только латиница, цифры, точка, дефис и подчёркивание');
  return login;
}

function assertLoginFree(login, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM users WHERE login = ? AND id != ?').get(login, exceptId)) throw new HttpError(409, 'Такой логин уже занят');
}

function activeAdminsExcept(id) {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND deleted_at IS NULL AND id != ?").get(id).c;
}

function readPay(b, current) {
  const out = {
    daily_rate: b.dailyRate !== undefined ? toCents(b.dailyRate, 'Оклад в день', { min: 0, max: 1e8 }) : (current?.daily_rate ?? 0),
    percent: b.percent !== undefined ? toNumber(b.percent, 'Процент от прибыли', { max: 100 }) : (current?.percent ?? 0),
    work_days: 127, // график без выходных по умолчанию — выходные ставятся в календаре
    daily_goal: b.dailyGoal !== undefined ? toCents(b.dailyGoal, 'Цель на день', { min: 0, max: 1e10 }) : (current?.daily_goal ?? 0),
    pay_start: current?.pay_start ?? today(),
    pay_fixed: b.payFixed !== undefined ? (b.payFixed ? 1 : 0) : (current?.pay_fixed ?? 1),
    pay_percent: b.payPercent !== undefined ? (b.payPercent ? 1 : 0) : (current?.pay_percent ?? 1),
  };
  if (b.payStart !== undefined && b.payStart !== '') {
    if (!isDate(b.payStart)) throw bad('Дата начала начислений: неверная дата');
    out.pay_start = b.payStart;
  }
  return out;
}

function setRate(userId, fromDate, rate, by) {
  db.prepare(
    `INSERT INTO rate_history (user_id, from_date, daily_rate, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, from_date) DO UPDATE SET daily_rate = excluded.daily_rate, created_by = excluded.created_by`
  ).run(userId, fromDate, rate, by);
}

admin.get('/users', (req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY role = 'admin', name COLLATE NOCASE").all();
  res.json(rows.map(publicUser));
});

admin.post('/users', async (req, res) => {
  const b = req.body ?? {};
  const login = readLogin(b.login);
  const name = toText(b.name, 'Имя', { min: 1, max: 80 });
  const password = String(b.password ?? '');
  if (password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  const role = b.role === 'admin' ? 'admin' : 'operator';
  const pay = readPay(b);
  assertLoginFree(login);
  const hash = await hashPassword(password);
  const id = tx(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO users (login, name, password_hash, role, daily_rate, percent, work_days, daily_goal, pay_start, pay_fixed, pay_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(login, name, hash, role, pay.daily_rate, pay.percent, pay.work_days, pay.daily_goal, pay.pay_start, pay.pay_fixed, pay.pay_percent)
        .lastInsertRowid
    );
    setRate(id, '2000-01-01', effectiveRate(pay), req.user.id);
    return id;
  });
  res.status(201).json(publicUser(getUser(id)));
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
  const pay = readPay(b, u);
  const password = b.password ? String(b.password) : '';
  if (password && password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  if (id === req.user.id && (role !== 'admin' || !active)) throw bad('Нельзя снять с себя права администратора или заблокировать себя');
  if (u.role === 'admin' && (role !== 'admin' || !active) && activeAdminsExcept(id) === 0) {
    throw bad('Должен остаться хотя бы один активный администратор');
  }
  let rateFrom = today();
  if (b.rateFrom) {
    if (!isDate(b.rateFrom)) throw bad('Дата новой ставки: неверная дата');
    rateFrom = b.rateFrom;
  }
  assertLoginFree(login, id);
  const hash = password ? await hashPassword(password) : u.password_hash;
  const bump = password || !active || role !== u.role ? 1 : 0;
  tx(() => {
    db.prepare(
      `UPDATE users SET login = ?, name = ?, role = ?, active = ?, password_hash = ?, daily_rate = ?, percent = ?, work_days = ?,
         daily_goal = ?, pay_start = ?, pay_fixed = ?, pay_percent = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?`
    ).run(login, name, role, active, hash, pay.daily_rate, pay.percent, pay.work_days, pay.daily_goal, pay.pay_start, pay.pay_fixed, pay.pay_percent, bump, nowIso(), id);
    // В историю ставок пишем то, что реально капает (0, если оклад выключен).
    if (effectiveRate(pay) !== effectiveRate(u)) setRate(id, rateFrom, effectiveRate(pay), req.user.id);
    // По желанию новый процент применяется и к сегодняшним поступлениям.
    if (b.applyPercentToday && effectivePercent(pay) !== effectivePercent(u)) {
      const s = getSettings();
      db.prepare('UPDATE profit_events SET percent = ? WHERE user_id = ? AND at >= ?').run(
        effectivePercent(pay),
        id,
        new Date(dayStartMs(today(), s.tz)).toISOString()
      );
    }
  });
  res.json(publicUser(getUser(id)));
});

// Удаление «мягкое»: история поступлений и выплат сохраняется для статистики.
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
    db.prepare('DELETE FROM ext_tokens WHERE user_id = ?').run(id);
  });
  res.json({ ok: true });
});

/* ---------- Живая доска и аналитика ---------- */

admin.get('/live', (req, res) => res.json(computeLive()));

admin.get('/analytics', (req, res) => {
  const range = parseDays(req.query);
  const userId = req.query.userId ? toId(req.query.userId) : null;
  const a = computeAnalytics({ ...range, userId, windowHours: req.query.w });
  res.json({ ...a, money: computeMoney({ ...range, userId }) });
});

/* ---------- Поступления прибыли ---------- */

function listEvents({ from, to, userId, source }) {
  const s = getSettings();
  const params = [new Date(dayStartMs(from, s.tz)).toISOString(), new Date(dayStartMs(addDays(to, 1), s.tz)).toISOString()];
  let sql = `SELECT e.*, u.name AS user_name FROM profit_events e JOIN users u ON u.id = e.user_id WHERE e.at >= ? AND e.at < ?`;
  if (userId) {
    sql += ' AND e.user_id = ?';
    params.push(userId);
  }
  if (source) {
    sql += ' AND e.source = ?';
    params.push(source);
  }
  return db.prepare(`${sql} ORDER BY e.at DESC, e.id DESC LIMIT 5000`).all(...params).map(publicEvent);
}

const SOURCES = ['extension', 'manual', 'admin', 'shift'];

admin.get('/events', (req, res) => {
  const { from, to } = parseDays(req.query);
  const source = SOURCES.includes(req.query.source) ? req.query.source : null;
  res.json(listEvents({ from, to, userId: req.query.userId ? toId(req.query.userId) : null, source }));
});

admin.get('/events.csv', (req, res) => {
  const { from, to } = parseDays(req.query);
  const rows = listEvents({ from, to, userId: req.query.userId ? toId(req.query.userId) : null });
  const SRC = { extension: 'расширение', manual: 'вручную', admin: 'админ', shift: 'смена' };
  csv(
    res,
    `postupleniya-${from}_${to}.csv`,
    ['Дата и время', 'Сотрудник', 'Прибыль, сом', '% сотрудника', 'Начислено сотруднику, сом', 'Источник', 'Показание на странице', 'Комментарий'],
    rows.map((e) => [
      new Date(e.at).toLocaleString('ru-RU', { timeZone: getSettings().tz }),
      e.userName,
      e.amount,
      e.percent,
      e.pay,
      SRC[e.source],
      e.reading ?? '',
      e.note,
    ])
  );
});

admin.post('/events', (req, res) => {
  const b = req.body ?? {};
  const user = getUser(toId(b.userId, 'Выберите сотрудника'));
  if (!user) throw bad('Сотрудник не найден');
  const amount = toCents(b.amount, 'Сумма', { min: -1e10, max: 1e10 });
  if (amount === 0) throw bad('Сумма не может быть нулевой');
  const at = b.at ? toIso(b.at, 'Время') : nowIso();
  const note = toText(b.note, 'Комментарий', { max: 300 });
  const percent = b.percent !== undefined && b.percent !== '' ? toNumber(b.percent, 'Процент', { max: 100 }) : undefined;
  res.status(201).json(publicEvent(addProfit({ user, amount, at, source: 'admin', note, percent, createdBy: req.user.id })));
});

admin.put('/events/:id', (req, res) => {
  const id = toId(req.params.id);
  const e = getEvent(id);
  if (!e) throw new HttpError(404, 'Запись не найдена');
  const b = req.body ?? {};
  const amount = b.amount !== undefined ? toCents(b.amount, 'Сумма', { min: -1e10, max: 1e10 }) : e.amount;
  const at = b.at !== undefined ? toIso(b.at, 'Время') : e.at;
  const note = b.note !== undefined ? toText(b.note, 'Комментарий', { max: 300 }) : e.note;
  const percent = b.percent !== undefined ? toNumber(b.percent, 'Процент', { max: 100 }) : e.percent;
  db.prepare('UPDATE profit_events SET amount = ?, at = ?, note = ?, percent = ? WHERE id = ?').run(amount, at, note, percent, id);
  res.json(publicEvent(getEvent(id)));
});

admin.delete('/events/:id', (req, res) => {
  const r = db.prepare('DELETE FROM profit_events WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Запись не найдена');
  res.json({ ok: true });
});

/* ---------- Ведомость, выплаты, график ---------- */

function payrollRows(from, to) {
  const users = db.prepare("SELECT * FROM users WHERE role = 'operator' AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all();
  return users.map((u) => {
    const p = exportPay(payrollFor(u, from, to));
    const b = balanceFor(u);
    return {
      userId: u.id,
      name: u.name,
      active: Boolean(u.active),
      dailyRate: fromCents(u.daily_rate),
      percent: u.percent,
      payFixed: u.pay_fixed !== 0,
      payPercent: u.pay_percent !== 0,
      ...p,
      balance: fromCents(b.balance),
    };
  });
}

admin.get('/payroll', (req, res) => {
  const { from, to } = parseDays(req.query);
  const rows = payrollRows(from, to);
  const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
  res.json({
    range: { from, to },
    rows,
    totals: { base: sum('base'), percentPay: sum('percentPay'), bonuses: sum('bonuses'), fines: sum('fines'), corrections: sum('corrections'), accrued: sum('accrued'), paid: sum('paid'), balance: sum('balance'), profit: sum('profit') },
  });
});

admin.get('/payroll.csv', (req, res) => {
  const { from, to } = parseDays(req.query);
  csv(
    res,
    `vedomost-${from}_${to}.csv`,
    ['Сотрудник', 'Рабочих дней', 'Оклад, сом', 'Прибыль, сом', '% от прибыли, сом', 'Бонусы', 'Штрафы', 'Правки', 'Начислено', 'Выплачено', 'Баланс к выплате (всего)'],
    payrollRows(from, to).map((r) => [r.name, r.workDays, r.base, r.profit, r.percentPay, r.bonuses, r.fines, r.corrections, r.accrued, r.paid, r.balance])
  );
});

admin.get('/payroll/:userId', (req, res) => {
  const { from, to } = parseDays(req.query);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(toId(req.params.userId));
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  res.json({ user: publicUser(u), totals: exportPay(payrollFor(u, from, to, { breakdown: true })), balance: fromCents(balanceFor(u).balance) });
});

function publicPayout(p) {
  return { id: p.id, userId: p.user_id, userName: p.user_name, amount: fromCents(p.amount), date: p.date, note: p.note, createdAt: p.created_at };
}

admin.get('/payouts', (req, res) => {
  const { from, to } = parseDays(req.query);
  const params = [from, to];
  let sql = 'SELECT p.*, u.name AS user_name FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.date >= ? AND p.date <= ?';
  if (req.query.userId) {
    sql += ' AND p.user_id = ?';
    params.push(toId(req.query.userId));
  }
  res.json(db.prepare(`${sql} ORDER BY p.date DESC, p.id DESC`).all(...params).map(publicPayout));
});

admin.post('/payouts', (req, res) => {
  const b = req.body ?? {};
  const user = getUser(toId(b.userId, 'Выберите сотрудника'));
  if (!user) throw bad('Сотрудник не найден');
  const amount = toCents(b.amount, 'Сумма', { min: 0.01, max: 1e10 });
  const date = b.date || today();
  if (!isDate(date)) throw bad('Неверная дата');
  const note = toText(b.note, 'Комментарий', { max: 200 });
  const id = tx(() => {
    const id = db.prepare('INSERT INTO payouts (user_id, amount, date, note, created_by) VALUES (?, ?, ?, ?, ?)').run(user.id, amount, date, note, req.user.id)
      .lastInsertRowid;
    if (b.notify !== false) {
      const sum = new Intl.NumberFormat('ru-RU').format(fromCents(amount));
      db.prepare("INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES ('payday', ?, ?, ?, ?)").run(
        `Выплачено ${sum} сом`,
        note,
        user.id,
        req.user.id
      );
    }
    return Number(id);
  });
  res.status(201).json(publicPayout(db.prepare('SELECT p.*, u.name AS user_name FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(id)));
});

// Выплатить всю сумму к выплате сразу нескольким сотрудникам (или всем, у кого есть долг).
admin.post('/payouts/bulk', (req, res) => {
  const b = req.body ?? {};
  const date = b.date || today();
  if (!isDate(date)) throw bad('Неверная дата');
  const note = toText(b.note, 'Комментарий', { max: 200 }) || 'Зарплата';
  const ids = b.userIds === 'all' ? null : Array.isArray(b.userIds) ? b.userIds.map((x) => toId(x)) : null;
  if (b.userIds !== 'all' && (!ids || !ids.length)) throw bad('Выберите сотрудников');
  const users = db
    .prepare("SELECT * FROM users WHERE role = 'operator' AND deleted_at IS NULL")
    .all()
    .filter((u) => !ids || ids.includes(u.id));
  const done = tx(() => {
    const out = [];
    for (const u of users) {
      const amount = Math.floor(balanceFor(u).balance);
      if (amount <= 0) continue;
      db.prepare('INSERT INTO payouts (user_id, amount, date, note, created_by) VALUES (?, ?, ?, ?, ?)').run(u.id, amount, date, note, req.user.id);
      if (b.notify !== false) {
        const sum = new Intl.NumberFormat('ru-RU').format(fromCents(amount));
        db.prepare("INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES ('payday', ?, ?, ?, ?)").run(
          `Выплачено ${sum} сом`,
          note,
          u.id,
          req.user.id
        );
      }
      out.push({ userId: u.id, name: u.name, amount: fromCents(amount) });
    }
    return out;
  });
  res.status(201).json({ count: done.length, total: Math.round(done.reduce((s, x) => s + x.amount, 0) * 100) / 100, paid: done });
});

admin.delete('/payouts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM payouts WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Запись не найдена');
  res.json({ ok: true });
});

// Отметки в графике: выходной / больничный / отпуск / доп. рабочий день.
admin.put('/days', (req, res) => {
  const b = req.body ?? {};
  const user = getUser(toId(b.userId, 'Выберите сотрудника'));
  if (!user) throw bad('Сотрудник не найден');
  let dates = Array.isArray(b.dates) ? b.dates : b.date ? [b.date] : [];
  // Диапазон «с … по …» — альтернатива списку дат.
  if (!dates.length && b.from && b.to) {
    if (!isDate(b.from) || !isDate(b.to) || b.from > b.to) throw bad('Неверный диапазон дат');
    if (daysBetween(b.from, b.to) > 400) throw bad('Слишком длинный диапазон (максимум 400 дней)');
    for (let d = b.from; d <= b.to; d = addDays(d, 1)) dates.push(d);
  }
  dates = [...new Set(dates)];
  if (!dates.length || dates.length > 400 || !dates.every(isDate)) throw bad('Неверные даты');
  const kind = b.kind || null;
  if (kind && !['off', 'absent', 'sick', 'vacation', 'work'].includes(kind)) throw bad('Неверный тип дня');
  const note = toText(b.note, 'Комментарий', { max: 120 });
  tx(() => {
    for (const d of dates) {
      if (!kind) db.prepare('DELETE FROM days_off WHERE user_id = ? AND date = ?').run(user.id, d);
      else
        db.prepare(
          'INSERT INTO days_off (user_id, date, kind, note) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET kind = excluded.kind, note = excluded.note'
        ).run(user.id, d, kind, note);
    }
  });
  res.json({ ok: true, count: dates.length });
});

// Администратор заполняет прибыль сотрудника за любой прошедший день.
admin.put('/day-profit', (req, res) => {
  const b = req.body ?? {};
  const user = getUser(toId(b.userId, 'Выберите сотрудника'));
  if (!user) throw bad('Сотрудник не найден');
  if (!isDate(b.date)) throw bad('Неверная дата');
  if (b.date > todayIn(tz())) throw bad('Нельзя заполнить прибыль за будущий день');
  const amount = toCents(b.amount, 'Прибыль', { min: -1e10, max: 1e10 });
  const note = toText(b.note, 'Комментарий', { max: 200 });
  res.json(setDayProfit({ user, date: b.date, amount, note, source: 'admin', by: req.user.id }));
});

admin.get('/schedule', (req, res) => {
  const { from, to } = parseDays(req.query);
  const u = getUser(toId(req.query.userId, 'Выберите сотрудника'));
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  res.json({ user: publicUser(u), ...scheduleFor(u, from, to) });
});

/* ---------- Рейтинг КПД ---------- */

admin.get('/rating', (req, res) => {
  const range = parseDays(req.query);
  res.json(computeRating(range));
});

/* ---------- Бонусы и штрафы ---------- */

function publicAdjustment(a) {
  return { id: a.id, userId: a.user_id, userName: a.user_name, kind: a.kind, amount: fromCents(a.amount), reason: a.reason, date: a.date, createdAt: a.created_at };
}

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
    date: b.date !== undefined ? toIso(b.date, 'Дата') : current.date,
  };
}

const getAdjustment = (id) => db.prepare('SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(id);

admin.get('/adjustments', (req, res) => {
  const { from, to } = parseDays(req.query);
  const s = getSettings();
  const params = [new Date(dayStartMs(from, s.tz)).toISOString(), new Date(dayStartMs(addDays(to, 1), s.tz)).toISOString()];
  let sql = 'SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id WHERE a.date >= ? AND a.date < ?';
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
      db.prepare('INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES (?, ?, ?, ?, ?)').run(
        a.kind,
        `${KIND_TITLE[a.kind]}: ${sum} сом`,
        a.reason,
        a.user_id,
        req.user.id
      );
    }
    return getAdjustment(Number(id));
  });
  res.status(201).json(publicAdjustment(row));
});

admin.put('/adjustments/:id', (req, res) => {
  const id = toId(req.params.id);
  const current = db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id);
  if (!current) throw new HttpError(404, 'Запись не найдена');
  const a = readAdjustment(req.body ?? {}, current);
  db.prepare('UPDATE adjustments SET kind = ?, amount = ?, reason = ?, date = ? WHERE id = ?').run(a.kind, a.amount, a.reason, a.date, id);
  res.json(publicAdjustment(getAdjustment(id)));
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
       WHERE n.created_by IS NOT NULL
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
    if (!isDate(paydayDate)) throw bad('Дата выдачи зарплаты: формат ГГГГ-ММ-ДД');
  }
  let target = null;
  if (b.targetUserId) {
    target = toId(b.targetUserId, 'Получатель не найден');
    if (!getUser(target)) throw bad('Получатель не найден');
  }
  const id = db
    .prepare('INSERT INTO notifications (kind, title, body, payday_date, target_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(kind, title, body, paydayDate, target, req.user.id).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});

admin.delete('/notifications/:id', (req, res) => {
  const r = db.prepare('DELETE FROM notifications WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Уведомление не найдено');
  res.json({ ok: true });
});

/* ---------- Ручная правка зарплаты (только администратор) ---------- */

function publicCorrection(c) {
  return {
    id: c.id,
    userId: c.user_id,
    userName: c.user_name,
    amount: fromCents(c.amount),
    before: fromCents(c.before),
    after: fromCents(c.before + c.amount),
    reason: c.reason,
    date: c.date,
    by: c.by_name ?? null,
    createdAt: c.created_at,
  };
}

const CORRECTION_SQL = `SELECT c.*, u.name AS user_name, b.name AS by_name FROM salary_corrections c
  JOIN users u ON u.id = c.user_id LEFT JOIN users b ON b.id = c.created_by`;

admin.get('/users/:id/salary', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(toId(req.params.id));
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  const b = balanceFor(u);
  res.json({
    balance: fromCents(b.balance),
    accrued: fromCents(b.accrued),
    paid: fromCents(b.paid),
    history: db.prepare(`${CORRECTION_SQL} WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 100`).all(u.id).map(publicCorrection),
  });
});

// Админ задаёт новую сумму «к выплате» (target) или изменение на сумму (delta).
// Разница записывается отдельной строкой в историю — прошлые начисления не переписываются.
admin.post('/users/:id/salary', (req, res) => {
  const u = getUser(toId(req.params.id));
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  const b = req.body ?? {};
  const reason = toText(b.reason, 'Причина', { max: 300 });
  const row = tx(() => {
    const before = balanceFor(u).balance;
    let delta;
    if (b.target !== undefined && b.target !== '') delta = toCents(b.target, 'Новая сумма', { min: -1e10, max: 1e10 }) - before;
    else delta = toCents(b.delta, 'Изменение', { min: -1e10, max: 1e10 });
    if (delta === 0) throw bad('Сумма не изменилась');
    const id = db
      .prepare('INSERT INTO salary_corrections (user_id, amount, before, reason, date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, delta, before, reason, nowIso(), req.user.id).lastInsertRowid;
    if (b.notify) {
      const sum = new Intl.NumberFormat('ru-RU').format(fromCents(before + delta));
      db.prepare("INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES ('info', ?, ?, ?, ?)").run(
        `Зарплата к выплате изменена: ${sum} сом`,
        reason,
        u.id,
        req.user.id
      );
    }
    return db.prepare(`${CORRECTION_SQL} WHERE c.id = ?`).get(Number(id));
  });
  res.status(201).json(publicCorrection(row));
});

admin.delete('/salary-corrections/:id', (req, res) => {
  const r = db.prepare('DELETE FROM salary_corrections WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Запись не найдена');
  res.json({ ok: true });
});

/* ---------- Авансы ---------- */

const ADV_SQL = `SELECT a.*, u.name AS user_name, d.name AS decided_name FROM advances a
  JOIN users u ON u.id = a.user_id LEFT JOIN users d ON d.id = a.decided_by`;
const ADV_ACTION = { created: 'запросил', cancelled: 'передумал и отменил', approved: 'одобрено', rejected: 'отклонено' };

function publicAdvance(a, withLog = false) {
  const out = {
    id: a.id,
    userId: a.user_id,
    userName: a.user_name,
    amount: fromCents(a.amount),
    reason: a.reason,
    status: a.status,
    decidedBy: a.decided_name ?? null,
    decidedAt: a.decided_at,
    decisionNote: a.decision_note,
    payoutId: a.payout_id,
    createdAt: a.created_at,
  };
  if (withLog) {
    out.log = db
      .prepare('SELECT l.*, u.name AS actor_name FROM advance_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.advance_id = ? ORDER BY l.at, l.id')
      .all(a.id)
      .map((l) => ({ action: l.action, text: ADV_ACTION[l.action], amount: fromCents(l.amount), note: l.note, actor: l.actor_name, at: l.at }));
  }
  return out;
}

const logAdvance = (advanceId, action, amount, note, actorId) =>
  db.prepare('INSERT INTO advance_log (advance_id, action, amount, note, actor_id, at) VALUES (?, ?, ?, ?, ?, ?)').run(advanceId, action, amount, note, actorId, nowIso());

api.get('/me/advances', (req, res) => {
  const u = req.user;
  const items = db.prepare(`${ADV_SQL} WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 100`).all(u.id);
  res.json({ balance: fromCents(balanceFor(u).balance), items: items.map((a) => publicAdvance(a)) });
});

api.post('/me/advances', (req, res) => {
  const u = req.user;
  if (u.role !== 'operator') throw bad('Аванс могут запросить только сотрудники');
  const amount = toCents(req.body?.amount, 'Сумма', { min: 0.01, max: 1e10 });
  const reason = toText(req.body?.reason, 'Комментарий', { max: 300 });
  const row = tx(() => {
    if (db.prepare("SELECT 1 FROM advances WHERE user_id = ? AND status = 'pending'").get(u.id)) {
      throw bad('У вас уже есть заявка на рассмотрении. Дождитесь решения или отмените её.');
    }
    const balance = balanceFor(u).balance;
    if (amount > balance) throw bad(`Можно запросить не больше, чем заработано: сейчас к выплате ${new Intl.NumberFormat('ru-RU').format(fromCents(Math.max(0, balance)))} сом`);
    const id = Number(db.prepare('INSERT INTO advances (user_id, amount, reason) VALUES (?, ?, ?)').run(u.id, amount, reason).lastInsertRowid);
    logAdvance(id, 'created', amount, reason, u.id);
    return db.prepare(`${ADV_SQL} WHERE a.id = ?`).get(id);
  });
  res.status(201).json(publicAdvance(row));
});

// Сотрудник передумал: заявка не удаляется, а получает статус «отменена» — админ видит это в журнале.
api.post('/me/advances/:id/cancel', (req, res) => {
  const a = db.prepare('SELECT * FROM advances WHERE id = ? AND user_id = ?').get(toId(req.params.id), req.user.id);
  if (!a) throw new HttpError(404, 'Заявка не найдена');
  if (a.status !== 'pending') throw bad('Отменить можно только заявку, которая ещё на рассмотрении');
  tx(() => {
    db.prepare("UPDATE advances SET status = 'cancelled', decided_at = ? WHERE id = ?").run(nowIso(), a.id);
    logAdvance(a.id, 'cancelled', a.amount, '', req.user.id);
  });
  res.json({ ok: true });
});

admin.get('/advances', (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const params = [];
  let sql = `${ADV_SQL} WHERE 1 = 1`;
  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (req.query.userId) {
    sql += ' AND a.user_id = ?';
    params.push(toId(req.query.userId));
  }
  const rows = db.prepare(`${sql} ORDER BY a.status = 'pending' DESC, a.created_at DESC LIMIT 300`).all(...params);
  const balances = new Map();
  const items = rows.map((a) => {
    const out = publicAdvance(a, true);
    if (a.status === 'pending') {
      if (!balances.has(a.user_id)) balances.set(a.user_id, fromCents(balanceFor(db.prepare('SELECT * FROM users WHERE id = ?').get(a.user_id)).balance));
      out.balance = balances.get(a.user_id);
    }
    return out;
  });
  const { pending } = db.prepare("SELECT COUNT(*) AS pending FROM advances WHERE status = 'pending'").get();
  res.json({ pending, items });
});

admin.get('/advances/pending', (req, res) => {
  res.json(db.prepare("SELECT COUNT(*) AS pending FROM advances WHERE status = 'pending'").get());
});

// Одобрение: аванс сразу записывается как выплата и уменьшает баланс сотрудника.
admin.post('/advances/:id/approve', (req, res) => {
  const note = toText(req.body?.note, 'Комментарий', { max: 300 });
  const out = tx(() => {
    const a = db.prepare('SELECT * FROM advances WHERE id = ?').get(toId(req.params.id));
    if (!a) throw new HttpError(404, 'Заявка не найдена');
    if (a.status !== 'pending') throw bad(a.status === 'cancelled' ? 'Сотрудник уже отменил эту заявку' : 'Заявка уже рассмотрена');
    const amount = req.body?.amount !== undefined && req.body.amount !== '' ? toCents(req.body.amount, 'Сумма', { min: 0.01, max: 1e10 }) : a.amount;
    const payoutId = Number(
      db
        .prepare('INSERT INTO payouts (user_id, amount, date, note, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(a.user_id, amount, today(), `Аванс${a.reason ? `: ${a.reason}` : ''}`, req.user.id).lastInsertRowid
    );
    db.prepare("UPDATE advances SET status = 'approved', amount = ?, decided_by = ?, decided_at = ?, decision_note = ?, payout_id = ? WHERE id = ?").run(
      amount,
      req.user.id,
      nowIso(),
      note,
      payoutId,
      a.id
    );
    logAdvance(a.id, 'approved', amount, note, req.user.id);
    const sum = new Intl.NumberFormat('ru-RU').format(fromCents(amount));
    db.prepare("INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES ('payday', ?, ?, ?, ?)").run(
      `Аванс одобрен: ${sum} сом`,
      note || 'Сумма вычтена из зарплаты к выплате.',
      a.user_id,
      req.user.id
    );
    return db.prepare(`${ADV_SQL} WHERE a.id = ?`).get(a.id);
  });
  res.json(publicAdvance(out, true));
});

admin.post('/advances/:id/reject', (req, res) => {
  const note = toText(req.body?.note, 'Причина', { max: 300 });
  const out = tx(() => {
    const a = db.prepare('SELECT * FROM advances WHERE id = ?').get(toId(req.params.id));
    if (!a) throw new HttpError(404, 'Заявка не найдена');
    if (a.status !== 'pending') throw bad(a.status === 'cancelled' ? 'Сотрудник уже отменил эту заявку' : 'Заявка уже рассмотрена');
    db.prepare("UPDATE advances SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?").run(req.user.id, nowIso(), note, a.id);
    logAdvance(a.id, 'rejected', a.amount, note, req.user.id);
    const sum = new Intl.NumberFormat('ru-RU').format(fromCents(a.amount));
    db.prepare("INSERT INTO notifications (kind, title, body, target_user_id, created_by) VALUES ('info', ?, ?, ?, ?)").run(
      `Аванс ${sum} сом отклонён`,
      note,
      a.user_id,
      req.user.id
    );
    return db.prepare(`${ADV_SQL} WHERE a.id = ?`).get(a.id);
  });
  res.json(publicAdvance(out, true));
});

/* ---------- Резервные копии ---------- */

admin.get('/backup', (req, res) => {
  const file = path.join(config.dataDir, `download-${Date.now()}.db`);
  snapshot(file);
  const name = `smeny-backup-${new Date().toISOString().slice(0, 10)}.db`;
  res.download(file, name, () => fs.rm(file, { force: true }, () => {}));
});

api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
