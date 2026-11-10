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

export function toNumber(value, field, { min = 0, max = 1e9, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`Поле «${field}» обязательно`);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`Поле «${field}»: неверное значение`);
  return n;
}

export function toIso(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`Поле «${field}» обязательно`);
    return null;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw bad(`Поле «${field}»: неверная дата`);
  return new Date(t).toISOString();
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

// Период: from/to — ISO-строки (to не включается), tz — getTimezoneOffset() клиента.
export function parseRange(q) {
  const to = q.to ? toIso(q.to, 'to') : new Date(Date.now() + 86400000).toISOString();
  const from = q.from ? toIso(q.from, 'from') : new Date(Date.now() - 30 * 86400000).toISOString();
  if (from >= to) throw bad('Неверный период');
  let tz = Number(q.tz) || 0;
  if (Math.abs(tz) > 900) tz = 0;
  return { from, to, tz };
}
