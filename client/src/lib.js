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

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const money = (v) => `${moneyFmt.format(v ?? 0)} сом`;
export const num = (v, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(v ?? 0);

export function hours(h) {
  if (h == null) return '—';
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} ч ${String(total % 60).padStart(2, '0')} мин`;
}

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');

// Значение для <input type="datetime-local"> в локальном времени.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export function todayKey() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Пресеты периодов. Возвращают { from, to } в ISO, to — исключительно.
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const PERIODS = {
  today: { label: 'Сегодня', get: (n) => [startOfDay(n), addDays(startOfDay(n), 1)] },
  week: {
    label: 'Неделя',
    get: (n) => {
      const s = addDays(startOfDay(n), -((n.getDay() + 6) % 7));
      return [s, addDays(s, 7)];
    },
  },
  month: { label: 'Месяц', get: (n) => [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)] },
  prevMonth: {
    label: 'Прошлый месяц',
    get: (n) => [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 1)],
  },
  days30: { label: '30 дней', get: (n) => [addDays(startOfDay(n), -29), addDays(startOfDay(n), 1)] },
  year: { label: 'Год', get: (n) => [new Date(n.getFullYear(), 0, 1), new Date(n.getFullYear() + 1, 0, 1)] },
  custom: { label: 'Свой период' },
};
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function periodRange(p) {
  if (p.key === 'custom') {
    const from = p.from ? new Date(`${p.from}T00:00`) : addDays(startOfDay(new Date()), -29);
    const to = p.to ? addDays(new Date(`${p.to}T00:00`), 1) : addDays(startOfDay(new Date()), 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const [from, to] = PERIODS[p.key].get(new Date());
  return { from: from.toISOString(), to: to.toISOString() };
}

export function periodQuery(p, extra = {}) {
  const { from, to } = periodRange(p);
  const q = new URLSearchParams({ from, to, tz: String(new Date().getTimezoneOffset()) });
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) q.set(k, v);
  return q.toString();
}

// Выбранный период запоминается на устройстве отдельно для каждой страницы.
export function usePeriod(storageKey, initial = 'month') {
  const [period, setPeriod] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`period:${storageKey}`));
      if (saved && PERIODS[saved.key]) return saved;
    } catch {}
    return { key: initial };
  });
  const update = (p) => {
    setPeriod(p);
    try {
      localStorage.setItem(`period:${storageKey}`, JSON.stringify(p));
    } catch {}
  };
  return [period, update];
}
