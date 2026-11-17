import { useState } from 'react';
import { api, money, hh, time, dateTime, num, useApi, ago, signed, dayLabel, WEEKDAYS_FULL, WEEKDAYS_ACC, plural } from '../lib.js';
import { Avatar, Empty, Icon, Seg, useToast } from './ui.jsx';

/* ---------- Лучшее время ---------- */

export function WindowCard({ window, windowHours, onHours, compact }) {
  return (
    <div className="card window-card">
      <div className="window-top">
        <span className="window-icon">
          <Icon name="flame" size={20} />
        </span>
        <div>
          <div className="eyebrow">Самое прибыльное время</div>
          {window ? (
            <div className="window-range">
              {hh(window.start)} – {hh(window.end)}
            </div>
          ) : (
            <div className="window-range muted">ещё не ясно</div>
          )}
        </div>
      </div>
      {window ? (
        <p className="window-text">
          За эти {window.hours} {window.hours === 1 ? 'час' : window.hours < 5 ? 'часа' : 'часов'} приходит <b>{num(window.share, 0)}%</b> прибыли — в среднем{' '}
          <b>{money(window.perHour)}</b> в час.
        </p>
      ) : (
        <p className="window-text muted">Нужно больше поступлений, чтобы посчитать.</p>
      )}
      {onHours && !compact && (
        <div className="window-ctrl">
          <span className="muted small">Длина окна</span>
          <Seg
            size="sm"
            value={windowHours}
            onChange={onHours}
            options={[1, 2, 3, 4, 6].map((h) => ({ value: h, label: `${h} ч` }))}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- Рейтинг ---------- */

const SORTS = {
  profit: { label: 'Прибыль', get: (r) => r.profit },
  perHour: { label: 'сом/ч', get: (r) => r.perHour },
  events: { label: 'Поступления', get: (r) => r.events },
};

export function Leaderboard({ rows, meId }) {
  const [sort, setSort] = useState('profit');
  if (!rows.length) return <Empty icon="award">Пока нет сотрудников</Empty>;
  const sorted = [...rows].sort((a, b) => SORTS[sort].get(b) - SORTS[sort].get(a));
  const top = Math.max(1, ...rows.map((r) => SORTS[sort].get(r)));
  return (
    <div className="card board">
      <Seg size="sm" value={sort} onChange={setSort} options={Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label }))} />
      <ol>
        {sorted.map((r, i) => (
          <li key={r.userId} className={r.userId === meId ? 'me' : ''}>
            <span className={`rank rank-${i + 1}`}>{i + 1}</span>
            <Avatar name={r.name} size="sm" />
            <div className="board-main">
              <div className="board-name">
                {r.name}
                {r.userId === meId && <span className="tag tag-accent">вы</span>}
              </div>
              <div className="board-bar">
                <i style={{ width: `${(SORTS[sort].get(r) / top) * 100}%` }} />
              </div>
              <div className="muted small">
                {r.events} поступл. · {r.activeHours} акт. ч · {money(r.perHour)}/ч{r.share ? ` · ${num(r.share, 0)}%` : ''}
              </div>
            </div>
            <div className="board-value">{sort === 'perHour' ? `${money(r.perHour)}/ч` : sort === 'events' ? r.events : money(r.profit)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Лента изменений прибыли ---------- */

export const SOURCE = {
  extension: { label: 'расширение', icon: 'puzzle' },
  manual: { label: 'вручную', icon: 'plus' },
  admin: { label: 'админ', icon: 'user' },
  shift: { label: 'смена (архив)', icon: 'clock' },
};

export function EventFeed({ events, showUser, onUndo, onEdit, empty = 'Поступлений пока нет' }) {
  if (!events.length) return <Empty icon="drop">{empty}</Empty>;
  let lastDay = null;
  return (
    <ul className="feed">
      {events.map((e) => {
        const local = new Date(e.at).toLocaleDateString('sv-SE');
        const day = local !== lastDay ? local : null;
        lastDay = local;
        const canUndo = onUndo && e.source === 'manual' && Date.now() - Date.parse(e.createdAt) < 15 * 60000;
        const Row = onEdit ? 'button' : 'div';
        return (
          <li key={e.id}>
            {day && showUser !== 'noday' && <div className="feed-day">{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
            <Row className={`feed-row ${onEdit ? 'feed-btn' : ''}`} onClick={onEdit ? () => onEdit(e) : undefined}>
              <span className={`feed-icon ${e.amount < 0 ? 'neg' : ''}`}>
                <Icon name={SOURCE[e.source]?.icon || 'drop'} size={16} />
              </span>
              <div className="feed-main">
                <div className="feed-title">
                  {showUser && <b>{e.userName}</b>}
                  <span className="muted">
                    {time(e.at)} · {SOURCE[e.source]?.label}
                    {e.reading != null && ` · на странице ${num(e.reading, 2)}`}
                  </span>
                </div>
                {e.note && <div className="small">{e.note}</div>}
              </div>
              <div className="feed-amount">
                <div className={e.amount < 0 ? 'neg' : 'pos'}>{signed(e.amount)}</div>
                {e.pay ? <div className="muted small">вам {signed(e.pay)}</div> : null}
              </div>
              {canUndo && (
                <button className="icon-btn" title="Отменить" onClick={() => onUndo(e)}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Простые выводы словами ---------- */

const shortDay = (d) => dayLabel(d, { day: 'numeric', month: 'short' });

export function buildInsights(a, { m, rating, mine = false } = {}) {
  if (!a) return [];
  const out = [];
  const t = a.totals;
  if (!t.profit) return [{ icon: '💤', text: 'За выбранный период поступлений нет — выберите другой период.' }];
  const d = a.compare?.deltaProfit;
  if (d != null && Math.abs(d) >= 1) {
    out.push({
      icon: d > 0 ? '📈' : '📉',
      tone: d > 0 ? 'good' : 'bad',
      text: `Прибыль ${d > 0 ? 'выросла' : 'упала'} на ${Math.abs(Math.round(d))}% по сравнению с ${shortDay(a.compare.from)} – ${shortDay(a.compare.to)} (${money(a.compare.profit)}).`,
    });
  }
  if (a.forecast) out.push({ icon: '🔮', text: `Если темп сохранится, к концу периода выйдет около ${money(a.forecast.profit)}.` });
  if (a.window) out.push({ icon: '⏰', text: `Самое прибыльное время — ${hh(a.window.start)}–${hh(a.window.end)}: здесь ${num(a.window.share, 0)}% всей прибыли.` });
  const wd = (a.byWeekday || []).filter((x) => x.avg > 0);
  if (wd.length >= 3) {
    const best = wd.reduce((b, x) => (x.avg > b.avg ? x : b));
    const worst = wd.reduce((b, x) => (x.avg < b.avg ? x : b));
    out.push({ icon: '📅', text: `Лучший день недели — ${WEEKDAYS_FULL[best.dow]} (в среднем ${money(Math.round(best.avg))}), слабее всего по ${WEEKDAYS_ACC[worst.dow]}.` });
  }
  if (t.bestDay) out.push({ icon: '🏆', text: `Рекорд периода — ${dayLabel(t.bestDay.date, { day: 'numeric', month: 'long' })}: ${money(t.bestDay.profit)}.` });
  if (t.days > 1) {
    out.push({
      icon: t.goodDays >= t.days ? '✅' : '🗓️',
      text: `Прибыль была в ${t.goodDays} из ${t.days} ${plural(t.days, 'дня', 'дней', 'дней')}, в среднем ${money(t.perDay)} в день, средний чек ${money(t.avgEvent)}.`,
    });
  }
  if (m && m.profit > 0) {
    out.push({
      icon: '💰',
      tone: m.payShare > 50 ? 'bad' : undefined,
      text: `На зарплаты уходит ${num(m.payShare, 0)}% прибыли (${money(m.payroll)}), чистыми остаётся ${money(m.net)}.`,
    });
  }
  if (rating?.rows?.length > 1) {
    const rows = rating.rows.filter((r) => r.profit > 0);
    if (rows.length) {
      const top = rows[0];
      out.push({ icon: '👑', text: `${mine && top.userId === rating.meId ? 'Вы лидер' : `Лидер`} по КПД — ${top.name} (${top.score} из 100).` });
      const me = mine && rating.rows.find((r) => r.userId === rating.meId);
      if (me && me.place > 1) {
        const above = rating.rows[me.place - 2];
        out.push({ icon: '🎯', tone: 'good', text: `Вы на ${me.place}-м месте с КПД ${me.score}. До ${above.name} — ${above.score - me.score} ${plural(above.score - me.score, 'балл', 'балла', 'баллов')}.` });
      }
      const low = rows[rows.length - 1];
      if (!mine && rows.length > 2 && low.score < 40) out.push({ icon: '🐢', tone: 'bad', text: `Ниже всех по КПД — ${low.name} (${low.score}). Стоит посмотреть, что мешает.` });
    }
  }
  return out;
}
