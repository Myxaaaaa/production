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
import { computeStats, publicAdjustment, publicShift, userSummary } from './stats.js';
import { HttpError, bad, fromCents, nowIso, parseRange, toCents, toIso, toId, toNumber, toText } from './util.js';

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
    createdAt: u.created_at,
  };
}

const getShift = (id) =>
  db.prepare('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
const getOpenShift = (userId) =>
  db
    .prepare('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.end_at IS NULL')
    .get(userId);
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);

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

/* ---------- Смена сотрудника ---------- */

api.get('/shifts/current', (req, res) => {
  const s = getOpenShift(req.user.id);
  res.json(s ? publicShift(s) : null);
});

api.post('/shifts/open', (req, res) => {
  const shift = tx(() => {
    if (getOpenShift(req.user.id)) throw new HttpError(409, 'У вас уже есть открытая смена');
    const u = req.user;
    const r = db
      .prepare(
        'INSERT INTO shifts (user_id, start_at, hourly_rate, shift_rate, percent, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(u.id, nowIso(), u.hourly_rate, u.shift_rate, u.percent, u.id);
    return getShift(Number(r.lastInsertRowid));
  });
  res.status(201).json(publicShift(shift));
});

api.post('/shifts/close', (req, res) => {
  const profit = toCents(req.body?.profit, 'Прибыль за смену');
  const note = toText(req.body?.note, 'Комментарий', { max: 500 });
  const shift = tx(() => {
    const s = getOpenShift(req.user.id);
    if (!s) throw new HttpError(409, 'Нет открытой смены');
    let end = nowIso();
    if (end <= s.start_at) end = new Date(Date.parse(s.start_at) + 1000).toISOString();
    db.prepare('UPDATE shifts SET end_at = ?, profit = ?, note = ?, updated_at = ? WHERE id = ?').run(
      end,
      profit,
      note,
      nowIso(),
      s.id
    );
    return getShift(s.id);
  });
  res.json(publicShift(shift));
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
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT start_at FROM shifts s WHERE s.user_id = u.id AND s.end_at IS NULL) AS open_since
       FROM users u WHERE u.deleted_at IS NULL ORDER BY u.role = 'admin', u.name COLLATE NOCASE`
    )
    .all();
  res.json(rows.map((u) => ({ ...publicUser(u), openSince: u.open_since })));
});

admin.post('/users', async (req, res) => {
  const b = req.body ?? {};
  const login = readLogin(b.login);
  const name = toText(b.name, 'Имя', { min: 1, max: 80 });
  const password = String(b.password ?? '');
  if (password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  const role = b.role === 'admin' ? 'admin' : 'operator';
  const rates = readRates(b);
  assertLoginFree(login);
  const hash = await hashPassword(password);
  const r = db
    .prepare(
      'INSERT INTO users (login, name, password_hash, role, hourly_rate, shift_rate, percent) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(login, name, hash, role, rates.hourly_rate, rates.shift_rate, rates.percent);
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
  tx(() => {
    db.prepare(
      `UPDATE users SET login = ?, name = ?, role = ?, active = ?, password_hash = ?, hourly_rate = ?, shift_rate = ?,
         percent = ?, token_version = token_version + ?, updated_at = ? WHERE id = ?`
    ).run(login, name, role, active, hash, rates.hourly_rate, rates.shift_rate, rates.percent, bump, nowIso(), id);
    // По желанию новые ставки применяются и к текущей открытой смене.
    if (b.applyToOpenShift) {
      db.prepare('UPDATE shifts SET hourly_rate = ?, shift_rate = ?, percent = ?, updated_at = ? WHERE user_id = ? AND end_at IS NULL').run(
        rates.hourly_rate,
        rates.shift_rate,
        rates.percent,
        nowIso(),
        id
      );
    }
  });
  res.json(publicUser(getUser(id)));
});

// Удаление «мягкое»: история смен и выплат сохраняется для статистики.
admin.delete('/users/:id', (req, res) => {
  const id = toId(req.params.id);
  if (id === req.user.id) throw bad('Нельзя удалить свою учётную запись');
  const u = getUser(id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (u.role === 'admin' && activeAdminsExcept(id) === 0) throw bad('Должен остаться хотя бы один администратор');
  if (getOpenShift(id)) throw new HttpError(409, 'У сотрудника открыта смена — сначала закройте её');
  db.prepare(
    `UPDATE users SET deleted_at = ?, active = 0, login = login || '#deleted-' || id,
       token_version = token_version + 1, updated_at = ? WHERE id = ?`
  ).run(nowIso(), nowIso(), id);
  res.json({ ok: true });
});

/* ---------- Смены ---------- */

admin.get('/shifts', (req, res) => {
  const { from, to } = parseRange(req.query);
  const params = [from, to];
  let sql = `SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
             WHERE s.start_at >= ? AND s.start_at < ?`;
  if (req.query.userId) {
    sql += ' AND s.user_id = ?';
    params.push(toId(req.query.userId));
  }
  if (req.query.status === 'open') sql += ' AND s.end_at IS NULL';
  if (req.query.status === 'closed') sql += ' AND s.end_at IS NOT NULL';
  sql += ' ORDER BY s.start_at DESC LIMIT 2000';
  // Открытые смены показываем всегда, даже если начаты до выбранного периода.
  const rows = db.prepare(sql).all(...params);
  if (req.query.status !== 'closed') {
    const ids = new Set(rows.map((r) => r.id));
    const open = db
      .prepare('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.end_at IS NULL')
      .all()
      .filter((s) => !ids.has(s.id) && (!req.query.userId || s.user_id === Number(req.query.userId)));
    rows.unshift(...open);
  }
  res.json(rows.map(publicShift));
});

function readShift(b, current) {
  const userId = current ? current.user_id : toId(b.userId, 'Выберите сотрудника');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || (!current && user.deleted_at)) throw bad('Сотрудник не найден');
  const startAt = b.startAt !== undefined ? toIso(b.startAt, 'Начало смены') : current.start_at;
  const endAt = b.endAt !== undefined ? toIso(b.endAt, 'Конец смены', { required: false }) : current.end_at;
  const profit = b.profit !== undefined ? toCents(b.profit, 'Прибыль', { required: false }) : current.profit;
  if (endAt && endAt <= startAt) throw bad('Конец смены должен быть позже начала');
  if (endAt && profit === null) throw bad('Для закрытой смены укажите прибыль');
  const base = current ?? user;
  return {
    user_id: userId,
    start_at: startAt,
    end_at: endAt,
    profit: endAt ? profit : (profit ?? null),
    note: b.note !== undefined ? toText(b.note, 'Комментарий', { max: 500 }) : (current?.note ?? ''),
    ...readRates(b, base),
  };
}

function uniqueOpenGuard(fn) {
  try {
    return fn();
  } catch (e) {
    if (String(e.message).includes('idx_shifts_one_open')) {
      throw new HttpError(409, 'У сотрудника уже есть открытая смена');
    }
    throw e;
  }
}

admin.post('/shifts', (req, res) => {
  const s = readShift(req.body ?? {});
  const id = uniqueOpenGuard(
    () =>
      db
        .prepare(
          `INSERT INTO shifts (user_id, start_at, end_at, profit, note, hourly_rate, shift_rate, percent, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(s.user_id, s.start_at, s.end_at, s.profit, s.note, s.hourly_rate, s.shift_rate, s.percent, req.user.id)
        .lastInsertRowid
  );
  res.status(201).json(publicShift(getShift(Number(id))));
});

admin.put('/shifts/:id', (req, res) => {
  const id = toId(req.params.id);
  const current = getShift(id);
  if (!current) throw new HttpError(404, 'Смена не найдена');
  const s = readShift(req.body ?? {}, current);
  uniqueOpenGuard(() =>
    db
      .prepare(
        `UPDATE shifts SET start_at = ?, end_at = ?, profit = ?, note = ?, hourly_rate = ?, shift_rate = ?, percent = ?,
           updated_at = ? WHERE id = ?`
      )
      .run(s.start_at, s.end_at, s.profit, s.note, s.hourly_rate, s.shift_rate, s.percent, nowIso(), id)
  );
  res.json(publicShift(getShift(id)));
});

admin.delete('/shifts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM shifts WHERE id = ?').run(toId(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Смена не найдена');
  res.json({ ok: true });
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
    date: b.date !== undefined ? toIso(b.date, 'Дата') : current.date,
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

admin.get('/stats', (req, res) => {
  const stats = computeStats(parseRange(req.query), { withPay: true });
  const onShift = db
    .prepare(
      `SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
       WHERE s.end_at IS NULL ORDER BY s.start_at`
    )
    .all()
    .map(publicShift);
  res.json({ ...stats, onShift });
});

admin.get('/backup', (req, res) => {
  const file = path.join(config.dataDir, `download-${Date.now()}.db`);
  snapshot(file);
  const name = `smeny-backup-${new Date().toISOString().slice(0, 10)}.db`;
  res.download(file, name, () => fs.rm(file, { force: true }, () => {}));
});

api.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
