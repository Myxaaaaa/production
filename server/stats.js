import { db } from './db.js';
import { addDays, daysBetween, fromCents, localNow, weekday } from './util.js';

const round2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// Сколько дней назад сотрудник ещё может сам внести или поправить прибыль.
export const PROFIT_EDIT_DAYS = 3;

/* ---------- Один день графика ---------- */

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function dayMinutes(d) {
  let m = toMin(d.end_time) - toMin(d.start_time);
  if (m <= 0) m += 1440; // смена через полночь
  return m;
}

function dayEnd(d) {
  return toMin(d.end_time) <= toMin(d.start_time) ? { date: addDays(d.date, 1), time: d.end_time } : { date: d.date, time: d.end_time };
}

const cmp = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
export const isEnded = (d, now) => cmp(now, dayEnd(d)) >= 0;
const isStarted = (d, now) => cmp(now, { date: d.date, time: d.start_time }) >= 0;

// planned — впереди, active — идёт сейчас, needs_profit — прошла без прибыли, done — прошла, absent — невыход.
export function dayState(d, now) {
  if (d.status === 'absent') return 'absent';
  if (isEnded(d, now)) return d.profit === null ? 'needs_profit' : 'done';
  if (isStarted(d, now)) return 'active';
  return d.profit === null ? 'planned' : 'done';
}

// Смена засчитывается, когда она закончилась или по ней уже внесена прибыль.
const isCounted = (d, now) => d.status === 'work' && (d.profit !== null || isEnded(d, now));

// Заработок за смену (в тыйынах): ставка за смену + часы × ставка в час + % от прибыли.
export function dayEarnings(d) {
  const hours = dayMinutes(d) / 60;
  const base = d.shift_rate + Math.round(hours * d.hourly_rate);
  const percent = Math.round(((d.profit || 0) * d.percent) / 100);
  return { hours, base, percent, total: base + percent };
}

// Что сотрудник может сделать со своим днём сам.
export function employeePerms(d, userId, now) {
  const ended = isEnded(d, now);
  return {
    canEditProfit:
      d.status === 'work' &&
      isStarted(d, now) &&
      d.date >= addDays(now.date, -PROFIT_EDIT_DAYS) &&
      (d.profit_by === null || d.profit_by === userId),
    canMarkAbsent: d.status === 'work' && d.profit === null,
    canUnmarkAbsent: d.status === 'absent' && d.absence_by === userId && !ended,
  };
}

export function publicDay(d, now, perms) {
  const e = dayEarnings(d);
  const counted = isCounted(d, now);
  return {
    id: d.id,
    userId: d.user_id,
    userName: d.user_name,
    date: d.date,
    startTime: d.start_time,
    endTime: d.end_time,
    status: d.status,
    state: dayState(d, now),
    absenceReason: d.absence_reason,
    absenceByName: d.absence_by_name ?? null,
    absenceBySelf: d.absence_by === d.user_id,
    absenceAt: d.absence_at,
    profit: fromCents(d.profit),
    note: d.note,
    hourlyRate: fromCents(d.hourly_rate),
    shiftRate: fromCents(d.shift_rate),
    percent: d.percent,
    hours: round2(e.hours),
    earnings: counted ? fromCents(e.total) : null,
    expectedEarnings: d.status === 'work' ? fromCents(e.total) : null,
    ...(perms ? employeePerms(d, d.user_id, now) : {}),
  };
}

export function publicAdjustment(a) {
  return {
    id: a.id,
    userId: a.user_id,
    userName: a.user_name,
    kind: a.kind,
    amount: fromCents(a.amount),
    reason: a.reason,
    date: a.date,
    createdAt: a.created_at,
  };
}

/* ---------- Агрегаты ---------- */

function emptyAgg() {
  return {
    shifts: 0,
    hours: 0,
    profit: 0,
    profitShifts: 0,
    profitHours: 0,
    base: 0,
    percent: 0,
    bonuses: 0,
    fines: 0,
    absences: 0,
    planned: 0,
    missing: 0,
  };
}

function addDay(agg, d, now) {
  if (d.status === 'absent') {
    agg.absences++;
    return;
  }
  if (!isCounted(d, now)) {
    agg.planned++;
    return;
  }
  const e = dayEarnings(d);
  agg.shifts++;
  agg.hours += e.hours;
  agg.base += e.base;
  agg.percent += e.percent;
  if (d.profit === null) agg.missing++;
  else {
    agg.profit += d.profit;
    agg.profitShifts++;
    agg.profitHours += e.hours;
  }
}

function addAdjustment(agg, a) {
  if (a.kind === 'bonus') agg.bonuses += a.amount;
  else agg.fines += a.amount;
}

const payroll = (agg) => agg.base + agg.percent + agg.bonuses - agg.fines;

function exportAgg(agg, withPay) {
  const out = {
    shifts: agg.shifts,
    hours: round2(agg.hours),
    profit: fromCents(agg.profit),
    profitPerHour: agg.profitHours >= 0.1 ? fromCents(Math.round(agg.profit / agg.profitHours)) : 0,
    avgProfit: agg.profitShifts > 0 ? fromCents(Math.round(agg.profit / agg.profitShifts)) : 0,
    absences: agg.absences,
    planned: agg.planned,
    missingProfit: agg.missing,
    attendance: pct(agg.shifts, agg.shifts + agg.absences),
  };
  if (withPay) {
    Object.assign(out, {
      base: fromCents(agg.base),
      percentPay: fromCents(agg.percent),
      bonuses: fromCents(agg.bonuses),
      fines: fromCents(agg.fines),
      total: fromCents(payroll(agg)),
    });
  }
  return out;
}

export const DAY_SQL = `
  SELECT w.*, u.name AS user_name, ab.name AS absence_by_name
  FROM workdays w JOIN users u ON u.id = w.user_id LEFT JOIN users ab ON ab.id = w.absence_by`;
const RANGE_SQL = `${DAY_SQL} WHERE w.date >= ? AND w.date < ?`;
const ADJ_SQL = `
  SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id
  WHERE a.date >= ? AND a.date < ?`;

// Личная сводка сотрудника за период.
export function userSummary(userId, { from, to }) {
  const now = localNow();
  const days = db.prepare(`${RANGE_SQL} AND w.user_id = ? ORDER BY w.date DESC`).all(from, to, userId);
  const adjustments = db.prepare(`${ADJ_SQL} AND a.user_id = ? ORDER BY a.date DESC, a.id DESC`).all(from, to, userId);
  const agg = emptyAgg();
  days.forEach((d) => addDay(agg, d, now));
  adjustments.forEach((a) => addAdjustment(agg, a));
  return {
    now,
    totals: exportAgg(agg, true),
    days: days.map((d) => publicDay(d, now, true)),
    adjustments: adjustments.map(publicAdjustment),
  };
}

const seriesMode = ({ from, to }) => (daysBetween(from, to) > 62 ? 'month' : 'day');
const bucketKey = (date, mode) => (mode === 'month' ? date.slice(0, 7) : date);

function emptySeries(range, mode) {
  const series = new Map();
  for (let k = range.from; k < range.to; k = addDays(k, 1)) {
    const key = bucketKey(k, mode);
    if (!series.has(key)) series.set(key, { profit: 0, shifts: 0, pay: 0, fines: 0, bonuses: 0 });
  }
  return series;
}

function operatorsFor(range) {
  return db
    .prepare(
      `SELECT id, name FROM users WHERE role = 'operator' AND (
         (deleted_at IS NULL AND active = 1) OR id IN (SELECT user_id FROM workdays WHERE date >= ? AND date < ?))`
    )
    .all(range.from, range.to);
}

// Общая статистика: итоги, рейтинг сотрудников и прибыль по дням/месяцам.
export function computeStats(range, { withPay }) {
  const now = localNow();
  const days = db.prepare(RANGE_SQL).all(range.from, range.to);
  const adjustments = withPay ? db.prepare(ADJ_SQL).all(range.from, range.to) : [];

  const per = new Map();
  const ensure = (id, name) => {
    if (!per.has(id)) per.set(id, { userId: id, name, agg: emptyAgg() });
    return per.get(id);
  };
  operatorsFor(range).forEach((u) => ensure(u.id, u.name));

  const total = emptyAgg();
  const mode = seriesMode(range);
  const series = emptySeries(range, mode);
  for (const d of days) {
    addDay(ensure(d.user_id, d.user_name).agg, d, now);
    addDay(total, d, now);
    if (isCounted(d, now) && d.profit !== null) {
      const b = series.get(bucketKey(d.date, mode));
      b.profit += d.profit;
      b.shifts++;
    }
  }
  for (const a of adjustments) {
    addAdjustment(ensure(a.user_id, a.user_name).agg, a);
    addAdjustment(total, a);
  }

  const leaderboard = [...per.values()]
    .map((p) => ({ userId: p.userId, name: p.name, ...exportAgg(p.agg, withPay) }))
    .sort((a, b) => b.profit - a.profit || b.hours - a.hours);

  return {
    range,
    now,
    totals: exportAgg(total, withPay),
    leaderboard,
    series: {
      mode,
      points: [...series.entries()].map(([key, v]) => ({ key, profit: fromCents(v.profit), shifts: v.shifts })),
    },
  };
}

/* ---------- Аналитика прибыли для администратора ---------- */

function periodTotals(range, now) {
  const agg = emptyAgg();
  db.prepare(RANGE_SQL).all(range.from, range.to).forEach((d) => addDay(agg, d, now));
  db.prepare(ADJ_SQL).all(range.from, range.to).forEach((a) => addAdjustment(agg, a));
  return agg;
}

function summarize(agg) {
  const pay = payroll(agg);
  return {
    ...exportAgg(agg, true),
    net: fromCents(agg.profit - pay),
    margin: agg.profit > 0 ? Math.round(((agg.profit - pay) / agg.profit) * 1000) / 10 : null,
  };
}

// Средняя прибыль за смену по каждому сотруднику за последние 60 дней — для прогноза.
function recentAverages(now) {
  const rows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS n, SUM(profit) AS sum FROM workdays
       WHERE status = 'work' AND profit IS NOT NULL AND date >= ? AND date <= ? GROUP BY user_id`
    )
    .all(addDays(now.date, -60), now.date);
  let n = 0;
  let sum = 0;
  const per = new Map();
  for (const r of rows) {
    n += r.n;
    sum += r.sum;
    if (r.n >= 3) per.set(r.user_id, r.sum / r.n);
  }
  return { overall: n ? sum / n : 0, per };
}

// Период для сравнения: для календарного месяца — прошлый месяц, иначе такой же отрезок перед периодом.
// Если период ещё идёт, берём из прошлого столько же дней, сколько уже прошло, иначе сравнение нечестное.
function previousRange({ from, to }, today) {
  let prev;
  const [y, m] = from.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  if (from.endsWith('-01') && to === nextMonth) {
    prev = { from: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), to: from };
  } else {
    prev = { from: addDays(from, -daysBetween(from, to)), to: from };
  }
  const tomorrow = addDays(today, 1);
  if (from < tomorrow && tomorrow < to) {
    const cut = addDays(prev.from, daysBetween(from, tomorrow));
    if (cut < prev.to) prev.to = cut;
  }
  return prev;
}

const roundSom = (cents) => fromCents(Math.round(cents / 100) * 100);

export function computeAnalytics(range) {
  const now = localNow();
  const days = db.prepare(`${RANGE_SQL} ORDER BY w.date`).all(range.from, range.to);
  const adjustments = db.prepare(ADJ_SQL).all(range.from, range.to);
  const prevRange = previousRange(range, now.date);

  const total = emptyAgg();
  const mode = seriesMode(range);
  const series = emptySeries(range, mode);
  const weekdays = Array.from({ length: 7 }, () => ({ profit: 0, shifts: 0 }));
  const byDate = new Map();
  const per = new Map();
  const ensure = (id, name) => {
    if (!per.has(id)) per.set(id, { userId: id, name, agg: emptyAgg() });
    return per.get(id);
  };
  operatorsFor(range).forEach((u) => ensure(u.id, u.name));

  const averages = recentAverages(now);
  const forecast = { remainingShifts: 0, expected: 0 };
  const absences = [];
  const missing = [];

  for (const d of days) {
    addDay(total, d, now);
    addDay(ensure(d.user_id, d.user_name).agg, d, now);
    if (d.status === 'absent') {
      absences.push(publicDay(d, now));
      continue;
    }
    if (!isCounted(d, now)) {
      forecast.remainingShifts++;
      forecast.expected += averages.per.get(d.user_id) ?? averages.overall;
      continue;
    }
    const e = dayEarnings(d);
    const b = series.get(bucketKey(d.date, mode));
    b.pay += e.total;
    b.shifts++;
    if (d.profit === null) {
      missing.push(publicDay(d, now));
      forecast.expected += averages.per.get(d.user_id) ?? averages.overall;
      continue;
    }
    b.profit += d.profit;
    weekdays[weekday(d.date)].profit += d.profit;
    weekdays[weekday(d.date)].shifts++;
    byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.profit);
  }
  for (const a of adjustments) {
    addAdjustment(total, a);
    addAdjustment(ensure(a.user_id, a.user_name).agg, a);
    const b = series.get(bucketKey(a.date, mode));
    if (b) b.pay += a.kind === 'bonus' ? a.amount : -a.amount;
  }

  const dated = [...byDate.entries()].map(([date, profit]) => ({ date, profit: fromCents(profit) }));
  dated.sort((a, b) => b.profit - a.profit);

  const employees = [...per.values()]
    .map((p) => {
      const s = summarize(p.agg);
      return { userId: p.userId, name: p.name, ...s, share: pct(p.agg.profit, total.profit) };
    })
    .filter((e) => e.shifts > 0 || e.absences > 0 || e.planned > 0)
    .sort((a, b) => b.profit - a.profit);

  const inProgress = range.from <= now.date && now.date < range.to;
  return {
    range,
    now,
    totals: summarize(total),
    previous: { range: prevRange, ...summarize(periodTotals(prevRange, now)) },
    series: {
      mode,
      points: [...series.entries()].map(([key, v]) => ({
        key,
        profit: fromCents(v.profit),
        pay: fromCents(v.pay),
        net: fromCents(v.profit - v.pay),
        shifts: v.shifts,
      })),
    },
    weekdays: weekdays.map((w, i) => ({
      dow: i,
      profit: fromCents(w.profit),
      shifts: w.shifts,
      avg: w.shifts ? fromCents(Math.round(w.profit / w.shifts)) : 0,
    })),
    best: dated[0] ?? null,
    worst: dated.length > 1 ? dated.at(-1) : null,
    employees,
    forecast:
      inProgress && forecast.remainingShifts + missing.length > 0
        ? {
            actual: fromCents(total.profit),
            remainingShifts: forecast.remainingShifts,
            missingShifts: missing.length,
            expectedRest: roundSom(forecast.expected),
            total: roundSom(total.profit + forecast.expected),
            avgPerShift: roundSom(averages.overall),
          }
        : null,
    absences: absences.reverse(),
    missing: missing.reverse(),
  };
}
