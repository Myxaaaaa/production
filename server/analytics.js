import { db } from './db.js';
import { getSettings } from './settings.js';
import { addDays, dayStartMs, daysBetween, dowOf, local, today as todayIn } from './time.js';
import { fromCents } from './util.js';
import { payrollFor, ratePerSecond } from './payroll.js';
import { prevRange } from './rating.js';

const round2 = (n) => Math.round(n * 100) / 100;
const c = (v) => fromCents(Math.round(v));

// Лучшее окно из w часов подряд (с переходом через полночь).
function bestWindow(byHour, w, days) {
  let best = null;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < w; k++) sum += byHour[(s + k) % 24];
    if (!best || sum > best.sum) best = { start: s, sum };
  }
  if (!best || best.sum <= 0) return null;
  const share = byHour.reduce((a, b) => a + b, 0);
  return {
    start: best.start,
    end: (best.start + w) % 24,
    hours: w,
    profit: c(best.sum),
    perDay: c(best.sum / Math.max(1, days)),
    perHour: c(best.sum / Math.max(1, days) / w),
    share: share > 0 ? round2((best.sum / share) * 100) : 0,
  };
}

// Аналитика поступлений за период [from, to] (локальные даты, включительно).
export function computeAnalytics({ from, to, userId = null, windowHours }) {
  const { tz, windowHours: defW } = getSettings();
  const w = Math.min(8, Math.max(1, Number(windowHours) || defW));
  const today = todayIn(tz);
  const fromIso = new Date(dayStartMs(from, tz)).toISOString();
  const toIso = new Date(dayStartMs(addDays(to, 1), tz)).toISOString();

  const params = [fromIso, toIso];
  let sql = `SELECT e.user_id, e.amount, e.at, u.name FROM profit_events e JOIN users u ON u.id = e.user_id
             WHERE e.at >= ? AND e.at < ?`;
  if (userId) {
    sql += ' AND e.user_id = ?';
    params.push(userId);
  }
  const events = db.prepare(`${sql} ORDER BY e.at`).all(...params);

  // Тот же расчёт для предыдущего периода такой же длины — для сравнения.
  const { from: pFrom, to: pTo, len } = prevRange(from, to, today);
  const pParams = [new Date(dayStartMs(pFrom, tz)).toISOString(), fromIso, ...(userId ? [userId] : [])];
  const prevRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS profit, COUNT(*) AS events FROM profit_events
       WHERE at >= ? AND at < ? ${userId ? 'AND user_id = ?' : ''}`
    )
    .get(...pParams);

  // Сколько дней периода уже прошло (для средних).
  const lastDay = to < today ? to : today;
  const elapsedDays = lastDay >= from ? daysBetween(from, lastDay) + 1 : 0;
  const weekdayCount = Array(7).fill(0);
  for (let d = from; d <= lastDay; d = addDays(d, 1)) weekdayCount[dowOf(d)]++;

  const byHour = Array(24).fill(0);
  const byHourCount = Array(24).fill(0);
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const byDay = new Map();
  const byDow = Array(7).fill(0);
  const activeHours = new Set();
  const perUser = new Map();
  const todayByHour = Array(24).fill(0);
  const pastByHour = Array(24).fill(0);
  let total = 0;
  let pastDays = new Set();

  for (const e of events) {
    const l = local(Date.parse(e.at), tz);
    total += e.amount;
    byHour[l.hour] += e.amount;
    byHourCount[l.hour]++;
    heat[l.dow][l.hour] += e.amount;
    byDow[l.dow] += e.amount;
    byDay.set(l.date, (byDay.get(l.date) || 0) + e.amount);
    activeHours.add(`${l.date} ${l.hour}`);
    if (l.date === today) todayByHour[l.hour] += e.amount;
    else {
      pastByHour[l.hour] += e.amount;
      pastDays.add(l.date);
    }
    if (!perUser.has(e.user_id)) perUser.set(e.user_id, { userId: e.user_id, name: e.name, profit: 0, events: 0, hours: new Set(), byHour: Array(24).fill(0) });
    const p = perUser.get(e.user_id);
    p.profit += e.amount;
    p.events++;
    p.hours.add(`${l.date} ${l.hour}`);
    p.byHour[l.hour] += e.amount;
  }

  // Ряд по дням (или месяцам для длинных периодов).
  const span = daysBetween(from, to) + 1;
  const mode = span > 62 ? 'month' : 'day';
  const series = new Map();
  if (mode === 'day') for (let d = from; d <= to; d = addDays(d, 1)) series.set(d, 0);
  for (const [d, v] of byDay) {
    const k = mode === 'month' ? d.slice(0, 7) : d;
    series.set(k, (series.get(k) || 0) + v);
  }

  // Кривая «сегодня» против среднего дня периода (накопительно по часам).
  const nowHour = local(Date.now(), tz).hour;
  const cum = (arr, div = 1, upto = 23) => {
    let s = 0;
    return arr.map((v, h) => {
      s += v;
      return h <= upto ? c(s / div) : null;
    });
  };
  const inRangeToday = from <= today && today <= to;
  const avgDays = Math.max(1, elapsedDays - (inRangeToday ? 1 : 0));

  let best = null;
  for (const [d, v] of byDay) if (!best || v > best.profit) best = { date: d, profit: v };

  // Прогноз до конца периода по текущему темпу.
  let forecast = null;
  if (inRangeToday && to > today) {
    const done = elapsedDays - 1 + Math.min(1, (nowHour + 1) / 24);
    if (done > 0.25) forecast = { profit: c((total / done) * span), days: span };
  }

  const leaderboard = [...perUser.values()]
    .map((p) => {
      const top = p.byHour.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
      return {
        userId: p.userId,
        name: p.name,
        profit: c(p.profit),
        events: p.events,
        activeHours: p.hours.size,
        perHour: p.hours.size ? c(p.profit / p.hours.size) : 0,
        share: total > 0 ? round2((p.profit / total) * 100) : 0,
        bestHour: p.profit > 0 ? top : null,
        window: bestWindow(p.byHour, w, elapsedDays),
      };
    })
    .sort((a, b) => b.profit - a.profit);

  // Сравнение с предыдущим отрезком той же длины, что уже прошла в текущем периоде.
  const pct = (a, b) => (b > 0 ? round2(((a - b) / b) * 100) : null);
  const goodDays = [...byDay.values()].filter((v) => v > 0).length;

  return {
    range: { from, to, tz },
    compare: {
      from: pFrom,
      to: pTo,
      profit: c(prevRow.profit),
      events: prevRow.events,
      perDay: c(prevRow.profit / len),
      deltaProfit: pct(total, prevRow.profit),
      deltaEvents: pct(events.length, prevRow.events),
    },
    byWeekday: byDow.map((v, dow) => ({ dow, total: c(v), avg: c(v / Math.max(1, weekdayCount[dow])) })),
    totals: {
      profit: c(total),
      events: events.length,
      activeHours: activeHours.size,
      perActiveHour: activeHours.size ? c(total / activeHours.size) : 0,
      perDay: elapsedDays ? c(total / elapsedDays) : 0,
      avgEvent: events.length ? c(total / events.length) : 0,
      goodDays,
      worstDay: (() => {
        let w = null;
        for (const [d, v] of byDay) if (d !== today && (!w || v < w.profit)) w = { date: d, profit: v };
        return w ? { date: w.date, profit: c(w.profit) } : null;
      })(),
      bestDay: best ? { date: best.date, profit: c(best.profit) } : null,
      days: elapsedDays,
    },
    forecast,
    series: { mode, points: [...series.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, v]) => ({ key, profit: c(v) })) },
    byHour: byHour.map((v, h) => ({ hour: h, profit: c(v), avg: c(v / Math.max(1, elapsedDays)), events: byHourCount[h] })),
    heat: heat.map((row, dow) => row.map((v) => c(v / Math.max(1, weekdayCount[dow])))),
    window: bestWindow(byHour, w, elapsedDays),
    windowHours: w,
    curve: inRangeToday
      ? { today: cum(todayByHour, 1, nowHour), avg: pastDays.size ? cum(pastByHour, avgDays) : null }
      : null,
    leaderboard,
  };
}

// Последние изменения прибыли (лента).
export function recentEvents({ userId = null, limit = 30 } = {}) {
  const rows = db
    .prepare(
      `SELECT e.*, u.name AS user_name FROM profit_events e JOIN users u ON u.id = e.user_id
       ${userId ? 'WHERE e.user_id = ?' : ''} ORDER BY e.at DESC, e.id DESC LIMIT ?`
    )
    .all(...(userId ? [userId, limit] : [limit]));
  return rows.map(publicEvent);
}

export function publicEvent(e) {
  return {
    id: e.id,
    userId: e.user_id,
    userName: e.user_name,
    amount: fromCents(e.amount),
    percent: e.percent,
    pay: fromCents(Math.round((e.amount * e.percent) / 100) + (e.base_pay || 0)),
    at: e.at,
    source: e.source,
    reading: fromCents(e.reading),
    page: e.page,
    note: e.note,
    createdAt: e.created_at,
  };
}

// Прибыль и заработок сотрудника за сегодня.
export function todayFor(user) {
  const { tz } = getSettings();
  const t = todayIn(tz);
  const p = payrollFor(user, t, t);
  return {
    date: t,
    profit: fromCents(p.profit),
    events: p.events,
    base: fromCents(p.base + p.legacy),
    percentPay: fromCents(p.percent),
    earned: fromCents(p.accrued),
    goal: fromCents(user.daily_goal),
    ratePerSecond: fromCents(ratePerSecond(user)),
  };
}

// Живая доска администратора: кто онлайн, когда было последнее поступление.
export function computeLive() {
  const { tz, idleMinutes, teamDailyGoal } = getSettings();
  const t = todayIn(tz);
  const startIso = new Date(dayStartMs(t, tz)).toISOString();
  const now = Date.now();
  const users = db.prepare("SELECT * FROM users WHERE role = 'operator' AND deleted_at IS NULL AND active = 1 ORDER BY name COLLATE NOCASE").all();
  const rows = users.map((u) => {
    const seen = db
      .prepare('SELECT last_seen_at, last_page FROM ext_tokens WHERE user_id = ? AND last_seen_at IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1')
      .get(u.id);
    const last = db.prepare('SELECT MAX(at) AS at FROM profit_events WHERE user_id = ?').get(u.id).at;
    const today = todayFor(u);
    const online = seen ? now - Date.parse(seen.last_seen_at) < 3 * 60000 : false;
    // Простой: расширение онлайн, но прибыли нет дольше порога (считаем от последнего поступления или начала дня).
    const since = last && last > startIso ? Date.parse(last) : Date.parse(startIso);
    const idle = Math.floor((now - since) / 60000);
    return {
      userId: u.id,
      name: u.name,
      online,
      lastSeen: seen?.last_seen_at ?? null,
      page: seen ? hostOf(seen.last_page) : '',
      lastEventAt: last,
      idleMinutes: idle,
      idleAlert: online && idle >= idleMinutes,
      ...today,
    };
  });
  const profit = rows.reduce((s, r) => s + r.profit, 0);
  return {
    date: t,
    tz,
    idleMinutes,
    team: { profit: round2(profit), goal: fromCents(teamDailyGoal), online: rows.filter((r) => r.online).length, earned: round2(rows.reduce((s, r) => s + r.earned, 0)) },
    rows,
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
