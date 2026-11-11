import { useCallback, useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('auth:expired'));
  if (!res.ok) throw new Error(data?.error || `Ошибка сервера (${res.status})`);
  return data;
}

export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState((s) => ({ ...s, error: e.message, loading: false })));
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

/* ---------- Числа и деньги ---------- */

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const money = (v) => `${moneyFmt.format(v ?? 0)} сом`;
// Целые сомы — для крупных итогов, где копейки только мешают читать.
const somFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const som = (v) => `${somFmt.format(Math.round(v ?? 0))} сом`;
export const num = (v, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(v ?? 0);

// Компактно для подписей осей и плиток: 12,5 тыс., 1,2 млн.
export function compact(v) {
  const a = Math.abs(v ?? 0);
  if (a >= 1e6) return `${num(v / 1e6, a >= 1e7 ? 0 : 1)} млн`;
  if (a >= 1e4) return `${num(v / 1e3, 0)} тыс`;
  return num(v, 0);
}

export function hours(h) {
  if (h == null) return '—';
  const total = Math.round(h * 60);
  const m = total % 60;
  return m ? `${Math.floor(total / 60)} ч ${m} мин` : `${Math.floor(total / 60)} ч`;
}

export function plural(n, one, few, many) {
  const m10 = Math.abs(n) % 10;
  const m100 = Math.abs(n) % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- Даты ---------- */
// Дни графика — строки 'YYYY-MM-DD'. Разбираем их как локальную дату без сдвигов.

export const keyToDate = (key) => new Date(`${key}T00:00:00`);
export function dateToKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayKey = () => dateToKey(new Date());
export function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateToKey(d);
}
export const weekdayIdx = (key) => (keyToDate(key).getDay() + 6) % 7; // 0 — Пн

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const WEEKDAYS_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export const dayMonth = (key) => keyToDate(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const dayShort = (key) => keyToDate(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
export const dayFull = (key) =>
  keyToDate(key).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

// «1–12 окт» или «28 сен — 5 окт»; to не включается.
export function rangeLabel(from, to) {
  const last = addDays(to, -1);
  if (from === last) return dayShort(from);
  if (from.slice(0, 7) === last.slice(0, 7)) return `${Number(from.slice(8))}–${dayShort(last)}`;
  return `${dayShort(from)} — ${dayShort(last)}`;
}

export function relativeDay(key, today = todayKey()) {
  const diff = Math.round((keyToDate(key) - keyToDate(today)) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff > 1 && diff < 7) return `через ${diff} ${plural(diff, 'день', 'дня', 'дней')}`;
  return dayShort(key);
}

export const monthKey = (key) => key.slice(0, 7);
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return dateToKey(d).slice(0, 7);
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
}
export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/* ---------- Периоды ---------- */
// Возвращают { from, to } — ключи дат, to не включается.

const startOfWeek = (key) => addDays(key, -weekdayIdx(key));
export const PERIODS = {
  today: { label: 'Сегодня', get: (t) => [t, addDays(t, 1)] },
  week: { label: 'Эта неделя', get: (t) => [startOfWeek(t), addDays(startOfWeek(t), 7)] },
  month: { label: 'Этот месяц', get: (t) => [`${monthKey(t)}-01`, `${shiftMonth(monthKey(t), 1)}-01`] },
  prevMonth: { label: 'Прошлый месяц', get: (t) => [`${shiftMonth(monthKey(t), -1)}-01`, `${monthKey(t)}-01`] },
  days30: { label: '30 дней', get: (t) => [addDays(t, -29), addDays(t, 1)] },
  days90: { label: '90 дней', get: (t) => [addDays(t, -89), addDays(t, 1)] },
  year: { label: 'Этот год', get: (t) => [`${t.slice(0, 4)}-01-01`, `${Number(t.slice(0, 4)) + 1}-01-01`] },
  custom: { label: 'Свой период' },
};

export function periodRange(p) {
  const t = todayKey();
  if (p.key === 'custom') {
    const from = p.from || addDays(t, -29);
    const to = p.to ? addDays(p.to, 1) : addDays(t, 1);
    return to > from ? { from, to } : { from, to: addDays(from, 1) };
  }
  const [from, to] = (PERIODS[p.key] ?? PERIODS.month).get(t);
  return { from, to };
}

export function rangeQuery({ from, to }, extra = {}) {
  const q = new URLSearchParams({ from, to });
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) q.set(k, v);
  return q.toString();
}
export const periodQuery = (p, extra) => rangeQuery(periodRange(p), extra);

// Выбранный период запоминается на устройстве отдельно для каждой страницы.
export function usePeriod(storageKey, initial = 'month') {
  const [period, setPeriod] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`period2:${storageKey}`));
      if (saved && PERIODS[saved.key]) return saved;
    } catch {}
    return { key: initial };
  });
  const update = (p) => {
    setPeriod(p);
    try {
      localStorage.setItem(`period2:${storageKey}`, JSON.stringify(p));
    } catch {}
  };
  return [period, update];
}

/* ---------- Состояния дня графика ---------- */

export const DAY_STATES = {
  planned: { label: 'По графику', tone: 'plan' },
  active: { label: 'Идёт смена', tone: 'live' },
  needs_profit: { label: 'Нет прибыли', tone: 'warn' },
  done: { label: 'Отработано', tone: 'done' },
  absent: { label: 'Не вышел', tone: 'bad' },
};

export const ABSENCE_REASONS = ['Болезнь', 'Отгул', 'Семейные обстоятельства', 'Учёба', 'Без предупреждения'];

export const initials = (name) =>
  (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
