import { db } from './db.js';
import { getSettings } from './settings.js';
import { addDays, dayFraction, dayStartMs, dowOf, local, today as todayIn } from './time.js';
import { fromCents } from './util.js';

// Зарплата считается «на лету»:
//   каждый рабочий день капает дневной оклад (сегодняшний — пропорционально прошедшему времени),
//   плюс % от каждого поступления прибыли (процент зафиксирован в момент поступления),
//   плюс бонусы, минус штрафы. Баланс = всё начисленное − выплаты.

const isoAt = (date, tz) => new Date(dayStartMs(date, tz)).toISOString();

export function rateTimeline(userId) {
  return db.prepare('SELECT from_date, daily_rate FROM rate_history WHERE user_id = ? ORDER BY from_date').all(userId);
}

function rateAt(timeline, date) {
  let r = 0;
  for (const x of timeline) {
    if (x.from_date <= date) r = x.daily_rate;
    else break;
  }
  return r;
}

export function dayOverrides(userId, from, to) {
  const m = new Map();
  for (const r of db.prepare('SELECT date, kind, note FROM days_off WHERE user_id = ? AND date >= ? AND date <= ?').all(userId, from, to)) {
    m.set(r.date, r);
  }
  return m;
}

export function isWorkDay(user, date, overrides) {
  const o = overrides.get(date);
  if (o) return o.kind === 'work';
  return ((user.work_days >> dowOf(date)) & 1) === 1;
}

// Расчёт по одному сотруднику за период [from, to] (включительно, локальные даты). Всё в тыйынах.
export function payrollFor(user, from, to, { breakdown = false } = {}) {
  const { tz } = getSettings();
  const now = Date.now();
  const today = todayIn(tz);
  const frac = dayFraction(tz, now);
  const timeline = rateTimeline(user.id);
  const overrides = dayOverrides(user.id, from, to);
  const days = new Map();
  const day = (d) => {
    if (!days.has(d)) days.set(d, { date: d, work: false, off: null, base: 0, profit: 0, percent: 0, bonuses: 0, fines: 0, corrections: 0, events: 0 });
    return days.get(d);
  };

  const r = { workDays: 0, base: 0, profit: 0, percent: 0, legacy: 0, bonuses: 0, fines: 0, corrections: 0, paid: 0, events: 0 };

  // Дневной оклад.
  let endDate = to < today ? to : today;
  if (user.deleted_at) {
    const del = local(Date.parse(user.deleted_at), tz).date;
    if (del < endDate) endDate = del;
  }
  const start = user.pay_start && user.pay_start > from ? user.pay_start : from;
  if (user.pay_start) {
    for (let d = start; d <= endDate; d = addDays(d, 1)) {
      const work = isWorkDay(user, d, overrides);
      const o = overrides.get(d);
      if (breakdown) Object.assign(day(d), { work, off: o && o.kind !== 'work' ? o.kind : null, override: o?.kind ?? null });
      if (!work) continue;
      const rate = rateAt(timeline, d);
      const amount = d === today ? rate * frac : rate;
      r.workDays += d === today ? frac : 1;
      r.base += amount;
      if (breakdown) day(d).base += amount;
    }
  }
  if (breakdown) {
    // Будущие и нерабочие дни периода тоже показываем (для календаря).
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
      const o = overrides.get(d);
      const x = day(d);
      x.override = o?.kind ?? null;
      if (!x.work && !x.off) {
        if (o && o.kind !== 'work') x.off = o.kind;
        else if (!user.pay_start || d < user.pay_start) x.off = 'before';
        else if (!isWorkDay(user, d, overrides)) x.off = 'weekend';
      }
    }
  }

  const fromIso = isoAt(from, tz);
  const toIso = isoAt(addDays(to, 1), tz);

  for (const e of db
    .prepare('SELECT amount, percent, base_pay, at FROM profit_events WHERE user_id = ? AND at >= ? AND at < ?')
    .all(user.id, fromIso, toIso)) {
    const pct = Math.round((e.amount * e.percent) / 100);
    r.profit += e.amount;
    r.percent += pct;
    r.legacy += e.base_pay;
    r.events++;
    if (breakdown) {
      const x = day(local(Date.parse(e.at), tz).date);
      x.profit += e.amount;
      // Ставка за перенесённые старые смены — это оклад за тот день.
      x.base += e.base_pay;
      x.percent += pct;
      x.events++;
    }
  }

  for (const a of db
    .prepare('SELECT kind, amount, date FROM adjustments WHERE user_id = ? AND date >= ? AND date < ?')
    .all(user.id, fromIso, toIso)) {
    if (a.kind === 'bonus') r.bonuses += a.amount;
    else r.fines += a.amount;
    if (breakdown) {
      const x = day(local(Date.parse(a.date), tz).date);
      if (a.kind === 'bonus') x.bonuses += a.amount;
      else x.fines += a.amount;
    }
  }

  // Ручные правки зарплаты администратором (со знаком).
  for (const a of db
    .prepare('SELECT amount, date FROM salary_corrections WHERE user_id = ? AND date >= ? AND date < ?')
    .all(user.id, fromIso, toIso)) {
    r.corrections += a.amount;
    if (breakdown) day(local(Date.parse(a.date), tz).date).corrections += a.amount;
  }

  r.paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE user_id = ? AND date >= ? AND date <= ?').get(user.id, from, to).s;

  r.base = Math.round(r.base);
  r.accrued = r.base + r.percent + r.legacy + r.bonuses - r.fines + r.corrections;
  if (breakdown) {
    r.days = [...days.values()]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((x) => {
        const base = Math.round(x.base);
        return { ...x, base, total: base + x.percent + x.bonuses - x.fines + x.corrections };
      });
  }
  return r;
}

// Баланс «к выплате» за всё время.
export function balanceFor(user) {
  const { tz } = getSettings();
  const r = payrollFor(user, '2000-01-01', todayIn(tz));
  const paidAll = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE user_id = ?').get(user.id).s;
  return { accrued: r.accrued, paid: paidAll, balance: r.accrued - paidAll };
}

// Сколько копеек в секунду капает сейчас (0, если сегодня выходной).
export function ratePerSecond(user) {
  const { tz } = getSettings();
  const t = todayIn(tz);
  if (!user.pay_start || user.pay_start > t) return 0;
  if (!isWorkDay(user, t, dayOverrides(user.id, t, t))) return 0;
  const len = (dayStartMs(addDays(t, 1), tz) - dayStartMs(t, tz)) / 1000;
  return rateAt(rateTimeline(user.id), t) / len;
}

export function exportPay(r) {
  const out = {
    workDays: Math.round(r.workDays * 100) / 100,
    base: fromCents(r.base + r.legacy),
    profit: fromCents(r.profit),
    percentPay: fromCents(r.percent),
    bonuses: fromCents(r.bonuses),
    fines: fromCents(r.fines),
    corrections: fromCents(r.corrections),
    accrued: fromCents(r.accrued),
    paid: fromCents(r.paid),
    events: r.events,
  };
  if (r.days) {
    out.days = r.days.map((d) => ({
      date: d.date,
      work: d.work,
      off: d.off,
      override: d.override ?? null,
      events: d.events,
      base: fromCents(d.base),
      profit: fromCents(d.profit),
      percentPay: fromCents(d.percent),
      bonuses: fromCents(d.bonuses),
      fines: fromCents(d.fines),
      corrections: fromCents(d.corrections),
      total: fromCents(d.total),
    }));
  }
  return out;
}

// График сотрудника на любой период (включая будущие дни): плановый статус дня + факт за прошедшие дни.
export function scheduleFor(user, from, to) {
  const { tz } = getSettings();
  const today = todayIn(tz);
  const overrides = dayOverrides(user.id, from, to);
  const fact = new Map();
  if (from <= today) {
    const p = payrollFor(user, from, to < today ? to : today, { breakdown: true });
    for (const d of p.days) fact.set(d.date, d);
  }
  const days = [];
  let planned = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const o = overrides.get(d);
    const before = !user.pay_start || d < user.pay_start;
    const work = !before && isWorkDay(user, d, overrides);
    if (work) planned++;
    const f = fact.get(d);
    days.push({
      date: d,
      work,
      kind: o?.kind ?? null,
      note: o?.note ?? '',
      before,
      profit: f ? fromCents(f.profit) : 0,
      total: f ? fromCents(f.total) : 0,
    });
  }
  return { range: { from, to }, today, planned, days };
}
