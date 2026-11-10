import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './util.js';

const COOKIE = 'smeny_sid';
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

function scrypt(password, salt, keylen, opts) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Хеш для несуществующих логинов, чтобы время ответа не выдавало их наличие.
let dummyHash;
export async function checkLogin(login, password) {
  const user = db.prepare('SELECT * FROM users WHERE login = ? AND deleted_at IS NULL').get(login);
  if (!user) {
    dummyHash ??= await hashPassword(crypto.randomBytes(8).toString('hex'));
    await verifyPassword(password, dummyHash);
    return null;
  }
  return (await verifyPassword(password, user.password_hash)) ? user : null;
}

export function setSessionCookie(req, res, user) {
  const token = jwt.sign({ sub: String(user.id), v: user.token_version }, config.sessionSecret, {
    algorithm: 'HS256',
    expiresIn: `${config.sessionDays}d`,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: config.sessionDays * 86400 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'Требуется вход');
  let payload;
  try {
    payload = jwt.verify(token, config.sessionSecret, { algorithms: ['HS256'] });
  } catch {
    clearSessionCookie(res);
    throw new HttpError(401, 'Сессия истекла, войдите снова');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user || user.deleted_at || !user.active || user.token_version !== payload.v) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Требуется вход');
  }
  req.user = user;
  // Скользящая сессия: раз в сутки продлеваем cookie.
  if (Date.now() / 1000 - payload.iat > 86400) setSessionCookie(req, res, user);
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Доступ только для администратора');
  next();
}

// Простейшее ограничение перебора паролей: 10 неудач за 15 минут с IP.
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
export function loginLimiter(req) {
  const key = req.ip;
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.first < WINDOW && rec.count >= 10) {
    throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
  }
  return {
    fail() {
      const r = attempts.get(key);
      if (!r || now - r.first >= WINDOW) attempts.set(key, { first: now, count: 1 });
      else r.count++;
    },
    success() {
      attempts.delete(key);
    },
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of attempts) if (now - r.first >= WINDOW) attempts.delete(k);
}, WINDOW).unref();

export async function seedAdmin() {
  const { login, password, name, resetPassword } = config.admin;
  if (login && password) {
    if (password.length < 8) console.warn('[WARN] ADMIN_PASSWORD короче 8 символов — смените его.');
    const existing = db.prepare('SELECT * FROM users WHERE login = ? AND deleted_at IS NULL').get(login);
    if (!existing) {
      db.prepare('INSERT INTO users (login, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
        login,
        name,
        await hashPassword(password),
        'admin'
      );
      console.log(`[auth] создан администратор «${login}»`);
    } else if (resetPassword) {
      db.prepare(
        `UPDATE users SET password_hash = ?, role = 'admin', active = 1,
           token_version = token_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).run(await hashPassword(password), existing.id);
      console.log(`[auth] пароль администратора «${login}» сброшен из ADMIN_PASSWORD (уберите ADMIN_RESET_PASSWORD)`);
    }
    return;
  }
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND deleted_at IS NULL").get();
  if (hasAdmin) return;
  if (config.isProd) {
    console.error('[ERROR] Нет ни одного администратора. Задайте ADMIN_LOGIN и ADMIN_PASSWORD и перезапустите.');
    return;
  }
  db.prepare('INSERT INTO users (login, name, password_hash, role) VALUES (?, ?, ?, ?)').run(
    'admin',
    'Администратор',
    await hashPassword('admin12345'),
    'admin'
  );
  console.warn('[dev] создан администратор admin / admin12345 (только для локальной разработки)');
}
