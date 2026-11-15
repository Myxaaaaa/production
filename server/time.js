// Работа с «рабочим» часовым поясом (по умолчанию Бишкек). Даты дней — строки ГГГГ-ММ-ДД.

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Локальные дата/час/день недели (0 = понедельник) для момента ms.
export function local(ms, tz) {
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    dow: WD[p.weekday],
  };
}

function offsetMs(ms, tz) {
  const l = local(ms, tz);
  const [y, m, d] = l.date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, l.hour, l.minute) - Math.floor(ms / 60000) * 60000;
}

// Момент начала локального дня date в UTC-миллисекундах.
export function dayStartMs(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const dowOf = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const today = (tz) => local(Date.now(), tz).date;

// Доля прошедшего локального дня (0..1) — для «капающей» дневной ставки.
export function dayFraction(tz, now = Date.now()) {
  const t = local(now, tz).date;
  const start = dayStartMs(t, tz);
  const end = dayStartMs(addDays(t, 1), tz);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}
