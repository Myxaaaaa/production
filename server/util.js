import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);

export const nowIso = () => new Date().toISOString();

// Деньги храним в тыйынах (1/100 сома, INTEGER), наружу отдаём в сомах.
export function toCents(value, field, { required = true, min = -1e10, max = 1e10 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`Поле «${field}» обязательно`);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw bad(`Поле «${field}»: неверное число`);
  if (n < min || n > max) throw bad(`Поле «${field}»: значение вне допустимого диапазона`);
  return Math.round(n * 100);
}

export const fromCents = (c) => (c === null || c === undefined ? null : c / 100);

export function toNumber(value, field, { min = 0, max = 1e9, required = true, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`Поле «${field}» обязательно`);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw bad(`Поле «${field}»: неверное значение`);
  }
  return n;
}

export function toText(value, field, { max = 200, min = 0 } = {}) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (s.length < min) throw bad(min === 1 ? `Поле «${field}» обязательно` : `Поле «${field}»: минимум ${min} симв.`);
  if (s.length > max) throw bad(`Поле «${field}»: максимум ${max} симв.`);
  return s;
}

export function toId(value, message = 'Не найдено') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, message);
  return n;
}

export function toIdList(value, field) {
  const list = Array.isArray(value) ? value : [value];
  const ids = [...new Set(list.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw bad(`Выберите: ${field}`);
  return ids;
}

/* ---------- Даты графика ---------- */
// Дни графика храним как 'YYYY-MM-DD', время — 'HH:MM' по часовому поясу бизнеса.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function toDateKey(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`Поле «${field}» обязательно`);
    return null;
  }
  const s = String(value).slice(0, 10);
  if (!isDateKey(s)) throw bad(`Поле «${field}»: неверная дата`);
  return s;
}

export function toTime(value, field) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw bad(`Поле «${field}»: время в формате ЧЧ:ММ`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// 0 — понедельник … 6 — воскресенье.
export const weekday = (key) => (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Текущие дата и время в часовом поясе бизнеса: { date: 'YYYY-MM-DD', time: 'HH:MM' }.
export function localNow(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Период: from включительно, to — исключительно, оба 'YYYY-MM-DD'.
export function parseRange(q) {
  const today = localNow().date;
  const to = q.to ? toDateKey(q.to, 'to') : addDays(today, 1);
  const from = q.from ? toDateKey(q.from, 'from') : addDays(to, -30);
  if (from >= to) throw bad('Неверный период');
  if (daysBetween(from, to) > 3700) throw bad('Слишком длинный период');
  return { from, to };
}
