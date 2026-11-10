import { db } from './db.js';
import { fromCents } from './util.js';

const round2 = (n) => Math.round(n * 100) / 100;

export function shiftHours(s) {
  if (!s.end_at) return null;
  return (Date.parse(s.end_at) - Date.parse(s.start_at)) / 3600000;
}

// Заработок за смену (в тыйынах): ставка за смену + часы × ставка в час + % от прибыли.
export function shiftEarnings(s) {
  const hours = shiftHours(s);
  if (hours === null) return null;
  const base = s.shift_rate + Math.round(hours * s.hourly_rate);
  const percent = Math.round(((s.profit || 0) * s.percent) / 100);
  return { hours, base, percent, total: base + percent };
}

export function publicShift(s) {
  const e = shiftEarnings(s);
  return {
    id: s.id,
    userId: s.user_id,
    userName: s.user_name,
    startAt: s.start_at,
    endAt: s.end_at,
    open: !s.end_at,
    profit: fromCents(s.profit),
    hourlyRate: fromCents(s.hourly_rate),
    shiftRate: fromCents(s.shift_rate),
    percent: s.percent,
    note: s.note,
    hours: e ? round2(e.hours) : null,
    earnings: e ? fromCents(e.total) : null,
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

function emptyAgg() {
  return { shifts: 0, hours: 0, profit: 0, base: 0, percent: 0, bonuses: 0, fines: 0 };
}

function addShift(agg, s) {
  const e = shiftEarnings(s);
  if (!e) return;
  agg.shifts++;
  agg.hours += e.hours;
  agg.profit += s.profit || 0;
  agg.base += e.base;
  agg.percent += e.percent;
}

function addAdjustment(agg, a) {
  if (a.kind === 'bonus') agg.bonuses += a.amount;
  else agg.fines += a.amount;
}

function exportAgg(agg, withPay) {
  const out = {
    shifts: agg.shifts,
    hours: round2(agg.hours),
    profit: fromCents(agg.profit),
    profitPerHour: agg.hours >= 0.1 ? fromCents(Math.round(agg.profit / agg.hours)) : 0,
    avgProfit: agg.shifts > 0 ? fromCents(Math.round(agg.profit / agg.shifts)) : 0,
  };
  if (withPay) {
    Object.assign(out, {
      base: fromCents(agg.base),
      percentPay: fromCents(agg.percent),
      bonuses: fromCents(agg.bonuses),
      fines: fromCents(agg.fines),
      total: fromCents(agg.base + agg.percent + agg.bonuses - agg.fines),
    });
  }
  return out;
}

const SHIFTS_SQL = `
  SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
  WHERE s.start_at >= ? AND s.start_at < ?`;
const ADJ_SQL = `
  SELECT a.*, u.name AS user_name FROM adjustments a JOIN users u ON u.id = a.user_id
  WHERE a.date >= ? AND a.date < ?`;

// Личная сводка сотрудника за период.
export function userSummary(userId, { from, to }) {
  const shifts = db.prepare(`${SHIFTS_SQL} AND s.user_id = ? ORDER BY s.start_at DESC`).all(from, to, userId);
  const adjustments = db.prepare(`${ADJ_SQL} AND a.user_id = ? ORDER BY a.date DESC`).all(from, to, userId);
  const agg = emptyAgg();
  shifts.forEach((s) => addShift(agg, s));
  adjustments.forEach((a) => addAdjustment(agg, a));
  return {
    totals: exportAgg(agg, true),
    shifts: shifts.map(publicShift),
    adjustments: adjustments.map(publicAdjustment),
  };
}

function bucketKey(iso, tz, mode) {
  const local = new Date(Date.parse(iso) - tz * 60000).toISOString();
  return mode === 'month' ? local.slice(0, 7) : local.slice(0, 10);
}

// Общая статистика: итоги, рейтинг сотрудников и прибыль по дням/месяцам.
export function computeStats({ from, to, tz }, { withPay }) {
  const shifts = db.prepare(`${SHIFTS_SQL} AND s.end_at IS NOT NULL`).all(from, to);
  const adjustments = withPay ? db.prepare(ADJ_SQL).all(from, to) : [];
  const operators = db
    .prepare("SELECT id, name FROM users WHERE role = 'operator' AND deleted_at IS NULL AND active = 1")
    .all();

  const per = new Map();
  const ensure = (id, name) => {
    if (!per.has(id)) per.set(id, { userId: id, name, agg: emptyAgg() });
    return per.get(id);
  };
  operators.forEach((u) => ensure(u.id, u.name));

  const total = emptyAgg();
  const mode = Date.parse(to) - Date.parse(from) > 62 * 86400000 ? 'month' : 'day';
  const series = new Map();
  if (mode === 'day') {
    for (let t = Date.parse(from); t < Date.parse(to); t += 86400000) {
      series.set(bucketKey(new Date(t).toISOString(), tz, mode), { profit: 0, shifts: 0 });
    }
  }

  for (const s of shifts) {
    addShift(ensure(s.user_id, s.user_name).agg, s);
    addShift(total, s);
    const key = bucketKey(s.start_at, tz, mode);
    const b = series.get(key) || { profit: 0, shifts: 0 };
    b.profit += s.profit || 0;
    b.shifts++;
    series.set(key, b);
  }
  for (const a of adjustments) {
    addAdjustment(ensure(a.user_id, a.user_name).agg, a);
    addAdjustment(total, a);
  }

  const leaderboard = [...per.values()]
    .map((p) => ({ userId: p.userId, name: p.name, ...exportAgg(p.agg, withPay) }))
    .sort((a, b) => b.profit - a.profit || b.hours - a.hours);

  return {
    range: { from, to },
    totals: exportAgg(total, withPay),
    leaderboard,
    series: {
      mode,
      points: [...series.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, v]) => ({ key, profit: fromCents(v.profit), shifts: v.shifts })),
    },
  };
}
