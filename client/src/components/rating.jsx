import { useState } from 'react';
import { money, num, plural } from '../lib.js';
import { Avatar, Delta, Empty, Icon } from './ui.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

const PARTS = {
  perDay: { label: 'Прибыль за рабочий день', short: 'в день' },
  roi: { label: 'Отдача на зарплату', short: 'отдача' },
  perHour: { label: 'Прибыль в активный час', short: 'в час' },
  stability: { label: 'Стабильность (дни с прибылью)', short: 'стабильн.' },
};

const scoreTone = (s) => (s >= 80 ? 'great' : s >= 55 ? 'good' : s >= 30 ? 'mid' : 'low');

// Рейтинг сотрудников по КПД: пьедестал для тройки лидеров и список с разбором балла.
export function KpdRating({ data, meId, compact }) {
  const [open, setOpen] = useState(null);
  const rows = data?.rows || [];
  if (!rows.length) return <Empty icon="trophy">Нет активных сотрудников</Empty>;
  if (rows.every((r) => !r.profit)) return <Empty icon="trophy">За период ещё нет прибыли — рейтинг появится после первых поступлений</Empty>;
  const top = rows.slice(0, 3);
  const rest = compact ? [] : rows.slice(3);
  const podium = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    <div className="kpd">
      <div className={`podium podium-${top.length}`}>
        {podium.map((r) => (
          <div key={r.userId} className={`pod pod-${r.place} ${r.userId === meId ? 'me' : ''}`}>
            <div className="pod-medal">{MEDALS[r.place - 1]}</div>
            <Avatar name={r.name} size={r.place === 1 ? 'lg' : 'md'} />
            <b className="pod-name">
              {r.name}
              {r.userId === meId && <span className="tag tag-accent">вы</span>}
            </b>
            <div className={`score score-${scoreTone(r.score)}`}>
              {r.score}
              <small>КПД</small>
            </div>
            <div className="muted small">{money(r.profit)}</div>
            <div className="pod-badges">
              {r.badges.map((b) => (
                <span key={b.id} title={b.label}>
                  {b.icon}
                </span>
              ))}
            </div>
            <div className="pod-step" />
          </div>
        ))}
      </div>

      {(compact ? top : rows).length > 0 && !compact && (
        <ol className="kpd-list">
          {rows.map((r) => (
            <li key={r.userId} className={`${r.userId === meId ? 'me' : ''} ${open === r.userId ? 'open' : ''}`}>
              <button type="button" className="kpd-row" onClick={() => setOpen(open === r.userId ? null : r.userId)}>
                <span className={`rank rank-${r.place}`}>{r.place <= 3 ? MEDALS[r.place - 1] : r.place}</span>
                <Avatar name={r.name} size="sm" />
                <div className="kpd-main">
                  <div className="kpd-name">
                    {r.name}
                    {r.userId === meId && <span className="tag tag-accent">вы</span>}
                    <span className="kpd-badges">
                      {r.badges.map((b) => (
                        <span key={b.id} title={b.label}>
                          {b.icon}
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="kpd-bar">
                    <i className={`score-${scoreTone(r.score)}`} style={{ width: `${r.score}%` }} />
                  </div>
                  <div className="muted small">
                    {money(r.profit)} · {money(r.perDay)}/день · {money(r.perHour)}/ч
                    {r.roi != null && ` · отдача ×${num(r.roi, 1)}`}
                  </div>
                </div>
                <div className={`score score-sm score-${scoreTone(r.score)}`}>{r.score}</div>
              </button>
              {open === r.userId && <Breakdown r={r} />}
            </li>
          ))}
          {rest.length === 0 && null}
        </ol>
      )}
      {!compact && (
        <p className="muted small kpd-note">
          <Icon name="info" size={14} /> КПД — балл от 0 до 100 по сравнению с лучшим в команде: прибыль за рабочий день ({data.weights.perDay}%)
          {data.rows[0]?.roi !== undefined ? `, отдача на зарплату (${data.weights.roi}%)` : ''}, прибыль в активный час ({data.weights.perHour}%), стабильность ({data.weights.stability}%). Нажмите
          на строку, чтобы увидеть разбор.
        </p>
      )}
    </div>
  );
}

function Breakdown({ r }) {
  return (
    <div className="kpd-break">
      {Object.entries(PARTS).map(([k, p]) =>
        r.parts[k] === undefined ? null : (
          <div key={k} className="kpd-part">
            <span>{p.label}</span>
            <div className="kpd-bar">
              <i style={{ width: `${r.parts[k]}%` }} />
            </div>
            <b>{r.parts[k]}</b>
          </div>
        )
      )}
      <div className="kpd-facts">
        <span>
          📅 {r.profitDays} из {r.workDays} раб. {plural(r.workDays, 'дня', 'дней', 'дней')} с прибылью
        </span>
        <span>⏱️ {r.activeHours} акт. ч · {r.events} поступл.</span>
        {r.goalDays != null && <span>🎯 цель выполнена {r.goalDays} {plural(r.goalDays, 'раз', 'раза', 'раз')}</span>}
        {r.streak > 0 && <span>🔥 серия {r.streak} дн.</span>}
        {r.accrued != null && <span>💰 зарплата {money(r.accrued)}</span>}
        <span>
          📈 <Delta value={r.growth} />
        </span>
      </div>
      {r.badges.length > 0 && (
        <div className="kpd-badge-list">
          {r.badges.map((b) => (
            <span key={b.id} className="badge-chip">
              {b.icon} {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
