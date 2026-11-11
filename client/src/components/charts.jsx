import { useEffect, useMemo, useRef, useState } from 'react';
import { compact, hours as fmtHours, money, num } from '../lib.js';
import { Avatar, Empty, Icon } from './ui.jsx';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= Math.ceil(max / step) * step + step / 2; t += step) ticks.push(Math.round(t));
  return ticks;
}

/*
  Столбчатая диаграмма одной величины.
  points: [{ key, label, title, value, rows: [[подпись, значение]] }]
*/
export function ColumnChart({ points, height = 220, highlight, label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const top = ticks.at(-1);
  const span = top - ticks[0] || 1;
  const y = (v) => ((top - v) / span) * 100;
  const zero = y(0);
  const plotW = Math.max(width - 52, 1);
  const labelW = Math.max(...points.map((p) => String(p.label).length)) * 7 + 16;
  const step = Math.max(1, Math.ceil((points.length * labelW) / plotW));
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="colchart" ref={ref} role="img" aria-label={label}>
      <div className="colchart-body" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="colchart-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${y(t)}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="colchart-plot">
          {ticks.map((t) => (
            <div key={t} className={`colchart-grid ${t === 0 ? 'colchart-base' : ''}`} style={{ top: `${y(t)}%` }} />
          ))}
          <div className="colchart-cols">
            {points.map((p, i) => {
              const v = p.value;
              const style =
                v >= 0
                  ? { top: `${y(v)}%`, height: `${zero - y(v)}%` }
                  : { top: `${zero}%`, height: `${y(v) - zero}%` };
              return (
                <div
                  key={p.key}
                  className={`colchart-col ${hover === i ? 'is-hover' : ''} ${highlight === p.key ? 'is-today' : ''}`}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(hover === i ? null : i)}
                >
                  {v !== 0 && <div className={`colchart-bar ${v < 0 ? 'is-neg' : ''}`} style={style} />}
                </div>
              );
            })}
          </div>
          {hp && (
            <div
              className="chart-tip"
              style={{
                left: `${((hover + 0.5) / points.length) * 100}%`,
                transform: `translateX(${hover / points.length < 0.2 ? '-12%' : hover / points.length > 0.8 ? '-88%' : '-50%'})`,
              }}
            >
              <div className="chart-tip-title">{hp.title}</div>
              {hp.rows.map(([k, val]) => (
                <div key={k} className="chart-tip-row">
                  <span>{k}</span>
                  <b>{val}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="colchart-x" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.key} className={highlight === p.key ? 'is-today' : ''}>
            {i % step === 0 ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Таблица-дублёр для графика: те же данные числами.
export function ChartTable({ head, rows }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={i ? 'num' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i} className={i ? 'num' : ''}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Горизонтальные полосы: rows [{ id, label, value, display, sub }] */
export function BarList({ rows, avatars }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="barlist-head">
            <span className="barlist-label">
              {avatars && <Avatar name={r.label} size="sm" />}
              {r.label}
            </span>
            <span className="barlist-value">{r.display}</span>
          </div>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${Math.max(0, (r.value / max) * 100)}%` }} />
          </div>
          {r.sub && <div className="barlist-sub">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

export function Meter({ value, total, label }) {
  const p = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label}>
      <div className="meter-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

/* ---------- Рейтинг сотрудников ---------- */

const SORTS = {
  profit: { label: 'Прибыль', get: (r) => r.profit },
  profitPerHour: { label: 'сом/ч', get: (r) => r.profitPerHour },
  hours: { label: 'Часы', get: (r) => r.hours },
  shifts: { label: 'Смены', get: (r) => r.shifts },
};

export function Leaderboard({ rows, meId, withPay }) {
  const [sort, setSort] = useState('profit');
  const sorted = useMemo(() => [...rows].sort((a, b) => SORTS[sort].get(b) - SORTS[sort].get(a)), [rows, sort]);
  if (!rows.length) return <Empty icon="users">Пока нет сотрудников</Empty>;
  return (
    <div className="card">
      <div className="card-toolbar">
        <div className="chips" role="tablist" aria-label="Сортировка">
          {Object.entries(SORTS).map(([k, s]) => (
            <button key={k} className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ol className="board">
        {sorted.map((r, i) => (
          <li key={r.userId} className={`board-row ${r.userId === meId ? 'board-me' : ''}`}>
            <span className={`rank ${i < 3 ? `rank-${i + 1}` : ''}`}>{i < 3 ? <Icon name="award" size={16} /> : i + 1}</span>
            <Avatar name={r.name} size="sm" />
            <div className="board-main">
              <div className="board-name">
                {r.name}
                {r.userId === meId && <span className="tag">вы</span>}
              </div>
              <div className="board-meta">
                {r.shifts} см. · {fmtHours(r.hours)} · {money(r.profitPerHour)}/ч
                {r.absences > 0 && ` · невыходов: ${r.absences}`}
              </div>
              {withPay && (
                <div className="board-meta">
                  К выплате <b>{money(r.total)}</b>
                  {r.bonuses > 0 && <span className="pos"> +{num(r.bonuses, 2)}</span>}
                  {r.fines > 0 && <span className="neg"> −{num(r.fines, 2)}</span>}
                </div>
              )}
            </div>
            <div className="board-value">
              {sort === 'hours'
                ? fmtHours(r.hours)
                : sort === 'shifts'
                  ? `${r.shifts} см.`
                  : sort === 'profitPerHour'
                    ? `${money(r.profitPerHour)}/ч`
                    : money(r.profit)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
