import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Router } from 'express';
import { db } from './db.js';
import { addProfit } from './events.js';
import { todayFor } from './analytics.js';
import { HttpError, bad, nowIso, toCents, toText } from './util.js';

// API для браузерного расширения. Вход — по личному токену (Authorization: Bearer smn_…),
// cookie не используются, поэтому CSRF здесь не страшен и CORS можно открыть.

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const newToken = () => `smn_${crypto.randomBytes(24).toString('base64url')}`;

export const ext = Router();

ext.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

ext.use((req, res, next) => {
  const m = /^Bearer\s+(smn_[\w-]{20,})$/.exec(req.get('authorization') || '');
  if (!m) throw new HttpError(401, 'Нет кода подключения');
  const tok = db.prepare('SELECT * FROM ext_tokens WHERE token_hash = ?').get(hashToken(m[1]));
  if (!tok) throw new HttpError(401, 'Код подключения отозван — создайте новый в приложении');
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(tok.user_id);
  if (!user || !user.active) throw new HttpError(403, 'Учётная запись заблокирована');
  req.token = tok;
  req.user = user;
  const page = toText(req.body?.page, 'page', { max: 300 });
  db.prepare("UPDATE ext_tokens SET last_seen_at = ?, last_page = CASE WHEN ? != '' THEN ? ELSE last_page END WHERE id = ?").run(
    nowIso(),
    page,
    page,
    tok.id
  );
  next();
});

const status = (req) => ({ user: { name: req.user.name, login: req.user.login }, today: todayFor(req.user) });

ext.post('/hello', (req, res) => res.json(status(req)));
ext.post('/ping', (req, res) => res.json(status(req)));

// Показание со страницы.
//  mode = 'counter' — на странице накопительная сумма: прибыль = прирост с прошлого показания,
//                     уменьшение считается сбросом счётчика (новый день/сессия);
//  mode = 'amount'  — каждое новое значение на странице — отдельная прибыль.
ext.post('/reading', (req, res) => {
  const b = req.body ?? {};
  const value = toCents(b.value, 'Показание', { min: -1e10, max: 1e10 });
  const mode = b.mode === 'amount' ? 'amount' : 'counter';
  const page = toText(b.page, 'page', { max: 300 });
  const clientId = b.clientId ? toText(b.clientId, 'clientId', { max: 64 }) : null;
  const tok = req.token;
  let amount = 0;
  let baseline = false;
  if (mode === 'amount') amount = value;
  else if (tok.last_reading === null || b.reset) baseline = true; // reset — только что выбрали новую сумму на странице
  else if (value > tok.last_reading) amount = value - tok.last_reading;
  else if (value < tok.last_reading) baseline = true;

  db.prepare('UPDATE ext_tokens SET last_reading = ?, last_reading_at = ? WHERE id = ?').run(value, nowIso(), tok.id);
  let added = null;
  if (amount !== 0 && !(mode === 'amount' && amount < 0)) {
    try {
      added = addProfit({ user: req.user, amount, at: nowIso(), source: 'extension', reading: value, page, clientId, createdBy: req.user.id });
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  res.json({ added: added ? added.amount / 100 : 0, baseline, ...status(req) });
});

// Ручное добавление прибыли из окна расширения.
ext.post('/profit', (req, res) => {
  const amount = toCents(req.body?.amount, 'Сумма', { min: -1e8, max: 1e8 });
  if (amount === 0) throw bad('Сумма не может быть нулевой');
  const note = toText(req.body?.note, 'Комментарий', { max: 200 });
  addProfit({ user: req.user, amount, at: nowIso(), source: 'manual', note, page: toText(req.body?.page, 'page', { max: 300 }), createdBy: req.user.id });
  res.json(status(req));
});

ext.use((req, res) => res.status(404).json({ error: 'Не найдено' }));

/* ---------- Архив расширения для скачивания (zip без сжатия) ---------- */

const EXT_DIR = path.resolve(import.meta.dirname, '../extension');

function listFiles(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFiles(path.join(dir, ent.name), rel));
    else out.push(rel);
  }
  return out;
}

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function extensionZip() {
  const root = 'smeny-extension';
  const parts = [];
  const central = [];
  let offset = 0;
  for (const rel of listFiles(EXT_DIR)) {
    const data = fs.readFileSync(path.join(EXT_DIR, rel));
    const name = Buffer.from(`${root}/${rel}`, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // имена в UTF-8
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    parts.push(head, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += head.length + name.length + data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}
