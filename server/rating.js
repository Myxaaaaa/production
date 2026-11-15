import { db } from './db.js';
import { getSettings } from './settings.js';
import { addDays, dayStartMs, daysBetween, local, today as todayIn } from './time.js';
import { fromCents } from './util.js';
import { payrollFor } from './payroll.js';

const round1 = (n) => Math.round(n * 10) / 10;
const iso = (date, tz) => new Date(dayStartMs(date, tz)).toISOString();

// Предыдущий отрезок такой же длины, как уже прошедшая часть периода, — для честного сравнения «было / стало».
// Например, для «месяца» на 15-е число сравниваем 1–15 ноября с 17–31 октября.
export function prevRange(from, to, today) {
  const end = today && to > today ? (today >= from ? today : from) : to;
  const len = daysBetween(from, end) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1), len };
}

const pctDelta = (now, before) => (before > 0 ? round1(((now - before) / before) * 100) : now > 0 ? null : 0);

// Сколько дней подряд (до сегодня включительно) у сотрудника была прибыль.
// Сегодняшний день без прибыли серию не обрывает — день ещё идёт.
export function streakFor(userId) {
  const { tz } = getSettings();
  const t = todayIn(tz);
  const since = iso(addDays(t, -120), tz);
  const days = new Set();
  for (const e of db.prepare('SELECT at FROM profit_events WHERE user_id = ? AND at >= ? AND amount > 0').all(userId, since)) {
    days.add(local(Date.parse(e.at), tz).date);
  }
  let d = days.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// Веса составляющих КПД (в сумме 100).
const WEIGHTS = { perDay: 35, roi: 25, perHour: 20, stability: 20 };

// Рейтинг сотрудников по КПД за период.
// КПД — балл 0–100 относительно лучшего в команде по каждой метрике:
//   прибыль за рабочий день, отдача на зарплату (сом прибыли на 1 сом зарплаты),
//   прибыль в активный час, стабильность (доля рабочих дней с прибылью).
export function computeRating({ from, to }, { forOperator = false } = {}) {
  const { tz } = getSettings();
  const today = todayIn(tz);
  const prev = prevRange(from, to, today);
  const users = db.prepare("SELECT * FROM users WHERE role = 'operator' AND deleted_at IS NULL AND active = 1 ORDER BY name COLLATE NOCASE").all();
  const hoursQ = db.prepare('SELECT at FROM profit_events WHERE user_id = ? AND at >= ? AND at < ?');

  const rows = users.map((u) => {
    const p = payrollFor(u, from, to, { breakdown: true });
    const before = payrollFor(u, prev.from, prev.to);
    const hours = new Set();
    for (const e of hoursQ.all(u.id, iso(from, tz), iso(addDays(to, 1), tz))) {
      const l = local(Date.parse(e.at), tz);
      hours.add(`${l.date} ${l.hour}`);
    }
    const workDays = p.days.filter((d) => d.work).length;
    const profitDays = p.days.filter((d) => d.profit > 0).length;
    const goalDays = u.daily_goal > 0 ? p.days.filter((d) => d.profit >= u.daily_goal).length : null;
    const pastWork = p.days.filter((d) => d.work && d.date < today).length;
    return {
      userId: u.id,
      name: u.name,
      profit: p.profit,
      prevProfit: before.profit,
      events: p.events,
      activeHours: hours.size,
      workDays,
      profitDays,
      goalDays,
      goal: u.daily_goal,
      accrued: p.accrued,
      perDay: p.profit / Math.max(1, workDays, profitDays),
      perHour: hours.size ? p.profit / hours.size : 0,
      roi: p.accrued > 0 ? p.profit / p.accrued : null,
      // Сегодняшний день в стабильность не входит, пока он не закончился (кроме случая, когда прибыль уже есть).
      stability: Math.min(1, profitDays / Math.max(1, profitDays, pastWork + (p.days.some((d) => d.date === today && d.profit > 0) ? 1 : 0))),
      streak: streakFor(u.id),
    };
  });

  const max = (k) => Math.max(0, ...rows.map((r) => r[k] ?? 0));
  const tops = { perDay: max('perDay'), roi: max('roi'), perHour: max('perHour'), stability: max('stability') };
  for (const r of rows) {
    let sum = 0;
    let w = 0;
    const parts = {};
    for (const [k, weight] of Object.entries(WEIGHTS)) {
      if (!tops[k]) continue;
      const v = Math.max(0, (r[k] ?? 0) / tops[k]);
      parts[k] = Math.round(v * 100);
      sum += v * weight;
      w += weight;
    }
    r.score = w ? Math.round((sum / w) * 100) : 0;
    r.parts = parts;
    r.growth = pctDelta(r.profit, r.prevProfit);
  }
  rows.sort((a, b) => b.score - a.score || b.profit - a.profit);

  // Значки — по одному лучшему в каждой номинации.
  const best = (k, ok = () => true) => {
    const c = rows.filter((r) => (r[k] ?? 0) > 0 && ok(r)).sort((a, b) => b[k] - a[k])[0];
    return c ? c.userId : null;
  };
  const awards = {
    profit: best('profit'),
    perHour: best('perHour'),
    roi: forOperator ? null : best('roi'),
    stability: best('stability', (r) => r.stability >= 0.8 && r.workDays >= 3),
    growth: best('growth', (r) => r.growth >= 10 && r.prevProfit > 0),
  };
  for (const r of rows) {
    r.badges = [];
    if (awards.profit === r.userId) r.badges.push({ id: 'profit', icon: '👑', label: 'Больше всех прибыли' });
    if (awards.perHour === r.userId) r.badges.push({ id: 'perHour', icon: '⚡', label: 'Самый быстрый час' });
    if (awards.roi === r.userId) r.badges.push({ id: 'roi', icon: '💎', label: 'Лучшая окупаемость' });
    if (awards.stability === r.userId) r.badges.push({ id: 'stability', icon: '🎯', label: 'Самый стабильный' });
    if (awards.growth === r.userId) r.badges.push({ id: 'growth', icon: '🚀', label: `Рост +${Math.round(r.growth)}%` });
    if (r.streak >= 3) r.badges.push({ id: 'streak', icon: '🔥', label: `${r.streak} дн. подряд с прибылью` });
  }

  const teamProfit = rows.reduce((s, r) => s + r.profit, 0);
  return {
    range: { from, to },
    prev,
    weights: WEIGHTS,
    rows: rows.map((r, i) => {
      const out = {
        place: i + 1,
        userId: r.userId,
        name: r.name,
        score: r.score,
        parts: r.parts,
        profit: fromCents(r.profit),
        growth: r.growth,
        share: teamProfit > 0 ? round1((r.profit / teamProfit) * 100) : 0,
        events: r.events,
        activeHours: r.activeHours,
        workDays: r.workDays,
        profitDays: r.profitDays,
        goalDays: r.goalDays,
        perDay: fromCents(Math.round(r.perDay)),
        perHour: fromCents(Math.round(r.perHour)),
        stability: Math.round(r.stability * 100),
        streak: r.streak,
        badges: r.badges,
      };
      if (!forOperator) {
        out.accrued = fromCents(r.accrued);
        out.roi = r.roi === null ? null : round1(r.roi);
      }
      return out;
    }),
  };
}

// Деньги за период: прибыль против фонда зарплаты, по дням и по составляющим.
export function computeMoney({ from, to, userId = null }) {
  const { tz } = getSettings();
  const today = todayIn(tz);
  const prev = prevRange(from, to, today);
  const users = db
    .prepare(`SELECT * FROM users WHERE role = 'operator' ${userId ? 'AND id = ?' : 'AND deleted_at IS NULL'}`)
    .all(...(userId ? [userId] : []));
  const span = daysBetween(from, to) + 1;
  const mode = span > 62 ? 'month' : 'day';
  const byKey = new Map();
  const tot = { profit: 0, base: 0, percent: 0, bonuses: 0, fines: 0, corrections: 0, accrued: 0 };
  const prevTot = { profit: 0, accrued: 0 };
  for (const u of users) {
    const p = payrollFor(u, from, to, { breakdown: true });
    tot.profit += p.profit;
    tot.base += p.base;
    tot.percent += p.percent + p.legacy;
    tot.bonuses += p.bonuses;
    tot.fines += p.fines;
    tot.corrections += p.corrections;
    tot.accrued += p.accrued;
    for (const d of p.days) {
      const k = mode === 'month' ? d.date.slice(0, 7) : d.date;
      const x = byKey.get(k) || { profit: 0, pay: 0 };
      x.profit += d.profit;
      x.pay += d.total;
      byKey.set(k, x);
    }
    const b = payrollFor(u, prev.from, prev.to);
    prevTot.profit += b.profit;
    prevTot.accrued += b.accrued;
  }
  const points = [];
  if (mode === 'day') {
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
      const x = byKey.get(d) || { profit: 0, pay: 0 };
      points.push({ key: d, profit: fromCents(x.profit), pay: fromCents(Math.round(x.pay)), net: fromCents(Math.round(x.profit - x.pay)) });
    }
  } else {
    for (const [k, x] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      points.push({ key: k, profit: fromCents(x.profit), pay: fromCents(Math.round(x.pay)), net: fromCents(Math.round(x.profit - x.pay)) });
    }
  }
  const net = tot.profit - tot.accrued;
  const prevNet = prevTot.profit - prevTot.accrued;
  return {
    profit: fromCents(tot.profit),
    payroll: fromCents(tot.accrued),
    base: fromCents(tot.base),
    percent: fromCents(tot.percent),
    bonuses: fromCents(tot.bonuses),
    fines: fromCents(tot.fines),
    corrections: fromCents(tot.corrections),
    net: fromCents(net),
    margin: tot.profit > 0 ? round1((net / tot.profit) * 100) : null,
    payShare: tot.profit > 0 ? round1((tot.accrued / tot.profit) * 100) : null,
    prev: { ...prev, profit: fromCents(prevTot.profit), payroll: fromCents(prevTot.accrued), net: fromCents(prevNet) },
    delta: {
      profit: pctDelta(tot.profit, prevTot.profit),
      payroll: pctDelta(tot.accrued, prevTot.accrued),
      net: prevNet > 0 ? pctDelta(net, prevNet) : null,
    },
    series: { mode, points },
  };
}
