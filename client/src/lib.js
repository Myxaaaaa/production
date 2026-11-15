import { useCallback, useEffect, useRef, useState } from 'react';

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

// Загрузка данных; refreshMs — тихое автообновление (без мигания «Загрузка…»).
export function useApi(path, { refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = useCallback(
    (silent = false) => {
      if (!path) return;
      if (!silent) setState((s) => ({ ...s, loading: true }));
      api(path)
        .then((data) => pathRef.current === path && setState({ data, error: null, loading: false }))
        .catch((e) => setState((s) => ({ ...s, error: e.message, loading: false })));
    },
    [path]
  );
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && load(true), refreshMs);
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load, refreshMs]);
  return { ...state, reload: () => load(true) };
}

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const money = (v) => `${moneyFmt.format(v ?? 0)}\u00a0сом`;
export const moneyShort = (v) => {
  const a = Math.abs(v ?? 0);
  if (a >= 1e6) return `${moneyFmt.format(Math.round((v / 1e6) * 10) / 10)} млн`;
  if (a >= 1e4) return `${moneyFmt.format(Math.round(v / 100) / 10)} тыс`;
  return money0.format(v ?? 0);
};
export const num = (v, d = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: d }).format(v ?? 0);
export const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${moneyFmt.format(Math.abs(v ?? 0))}`;

export const hh = (h) => `${String(h).padStart(2, '0')}:00`;

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
export const dayLabel = (d, opts = { day: 'numeric', month: 'long' }) => new Date(`${d}T12:00`).toLocaleDateString('ru-RU', opts);
export const weekday = (d) => new Date(`${d}T12:00`).toLocaleDateString('ru-RU', { weekday: 'short' });

export function ago(iso) {
  if (!iso) return 'никогда';
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин назад`;
  return dateTime(iso);
}

export function minutes(m) {
  if (m == null) return '—';
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

// Значение для <input type="datetime-local"> в локальном времени.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const todayKey = () => ymd(new Date());
export function addDays(key, n) {
  const d = new Date(`${key}T12:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Пресеты периодов: локальные даты [from, to] включительно.
const t0 = () => new Date();
export const PERIODS = {
  today: { label: 'Сегодня', get: () => [todayKey(), todayKey()] },
  yesterday: { label: 'Вчера', get: () => [addDays(todayKey(), -1), addDays(todayKey(), -1)] },
  week: {
    label: 'Неделя',
    get: () => {
      const s = addDays(todayKey(), -((t0().getDay() + 6) % 7));
      return [s, addDays(s, 6)];
    },
  },
  month: {
    label: 'Месяц',
    get: () => {
      const n = t0();
      return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))];
    },
  },
  prevMonth: {
    label: 'Прошлый месяц',
    get: () => {
      const n = t0();
      return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))];
    },
  },
  days30: { label: '30 дней', get: () => [addDays(todayKey(), -29), todayKey()] },
  year: { label: 'Год', get: () => [`${t0().getFullYear()}-01-01`, `${t0().getFullYear()}-12-31`] },
  custom: { label: 'Свой период' },
};

export function periodRange(p) {
  if (p.key === 'custom') {
    const from = p.from || addDays(todayKey(), -29);
    const to = p.to && p.to >= from ? p.to : todayKey() >= from ? todayKey() : from;
    return { from, to };
  }
  const [from, to] = (PERIODS[p.key] || PERIODS.month).get();
  return { from, to };
}

export function periodQuery(p, extra = {}) {
  const q = new URLSearchParams(periodRange(p));
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) q.set(k, v);
  return q.toString();
}

// Значение, сохраняемое на устройстве (период, фильтры, вкладки).
export function useStored(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key));
      if (s !== null && s !== undefined) return s;
    } catch {}
    return initial;
  });
  const update = (next) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [v, update];
}

export function usePeriod(storageKey, initial = 'month') {
  const [p, setP] = useStored(`period:${storageKey}`, { key: initial });
  return [PERIODS[p?.key] ? p : { key: initial }, setP];
}

// «Капающая» сумма: base растёт на perSecond каждую секунду с момента since.
export function useTicker(base, perSecond, since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!perSecond) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [perSecond]);
  if (!perSecond || !since) return base;
  return base + (perSecond * Math.max(0, now - since)) / 1000;
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Схема оплаты сотрудника словами.
export function payModeText(u) {
  const fixed = u.payFixed !== false;
  const pct = u.payPercent !== false;
  if (fixed && pct) return `${money(u.dailyRate)}/день + ${num(u.percent, 2)}%`;
  if (fixed) return `только оклад ${money(u.dailyRate)}/день`;
  if (pct) return `только ${num(u.percent, 2)}% с прибыли`;
  return 'без оклада и %';
}

export const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAYS_ACC = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];
