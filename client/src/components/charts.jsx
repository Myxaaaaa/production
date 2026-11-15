import { useMemo, useState } from 'react';
import { money, hh, WEEKDAYS, dayLabel } from '../lib.js';
import { Empty } from './ui.jsx';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function pointLabel(key, mode) {
  if (mode === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
  }
  const [, m, d] = key.split('-');
  return `${Number(d)}.${m}`;
}

// «Красивый» шаг сетки.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const axisFmt = (v) => (v >= 1e6 ? `${v / 1e6}м` : v >= 1e3 ? `${v / 1e3}к` : String(v));

function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: `${tip.x}%`, top: tip.y }}>
      <b>{tip.title}</b>
      {tip.lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

/* ---------- Столбцы по дням / месяцам ---------- */

export function BarChart({ series, height = 180 }) {
  const [tip, setTip] = useState(null);
  const pts = series.points;
  const max = niceMax(Math.max(0, ...pts.map((p) => p.profit)));
  if (!pts.length || pts.every((p) => !p.profit)) return <Empty icon="bars">Нет поступлений за период</Empty>;
  const W = Math.max(pts.length * 22, 300);
  const H = height;
  const bw = Math.min(28, (W / pts.length) * 0.62);
  const step = W / pts.length;
  const labelEvery = Math.ceil(pts.length / 12);
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="chart-y">
        {[1, 0.5, 0].map((f) => (
          <span key={f} style={{ top: `${(1 - f) * 100}%` }}>
            {axisFmt(max * f)}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          {pts.map((p, i) => {
            const h = (p.profit / max) * H;
            const x = i * step + (step - bw) / 2;
            return (
              <g
                key={p.key}
                onMouseEnter={() =>
                  setTip({ x: ((i + 0.5) / pts.length) * 100, y: 0, title: series.mode === 'month' ? pointLabel(p.key, 'month') : dayLabel(p.key, { day: 'numeric', month: 'long', weekday: 'short' }), lines: [money(p.profit)] })
                }
              >
                <rect x={i * step} y="0" width={step} height={H} fill="transparent" />
                {h > 0 && <path d={roundTop(x, H - h, bw, h, 4)} className={`bar ${tip && tip.x === ((i + 0.5) / pts.length) * 100 ? 'bar-hot' : ''}`} />}
              </g>
            );
          })}
        </svg>
        <div className="chart-x">
          {pts.map((p, i) => (
            <span key={p.key} style={{ visibility: i % labelEvery === 0 ? 'visible' : 'hidden' }}>
              {pointLabel(p.key, series.mode)}
            </span>
          ))}
        </div>
        <Tip tip={tip} />
      </div>
    </div>
  );
}

function roundTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/* ---------- Прибыль по часам суток + лучшее окно ---------- */

export function HourBars({ byHour, window, height = 150 }) {
  const [tip, setTip] = useState(null);
  const max = niceMax(Math.max(0, ...byHour.map((h) => h.avg)));
  if (byHour.every((h) => !h.profit)) return <Empty icon="clock">Пока нет поступлений, чтобы найти лучшее время</Empty>;
  const inWin = (h) => window && ((h - window.start + 24) % 24) < window.hours;
  const W = 24 * 20;
  const H = height;
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="chart-y">
        {[1, 0.5, 0].map((f) => (
          <span key={f} style={{ top: `${(1 - f) * 100}%` }}>
            {axisFmt(max * f)}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
          {window && (
            <WindowBand start={window.start} hours={window.hours} W={W} H={H} />
          )}
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          {byHour.map((b) => {
            const h = (b.avg / max) * H;
            return (
              <g
                key={b.hour}
                onMouseEnter={() =>
                  setTip({
                    x: ((b.hour + 0.5) / 24) * 100,
                    y: 0,
                    title: `${hh(b.hour)}–${hh((b.hour + 1) % 24)}`,
                    lines: [`В среднем ${money(b.avg)} в день`, `Всего ${money(b.profit)} · ${b.events} поступл.`],
                  })
                }
              >
                <rect x={b.hour * 20} y="0" width="20" height={H} fill="transparent" />
                {h > 0 && <path d={roundTop(b.hour * 20 + 3, H - h, 14, h, 3)} className={`bar ${inWin(b.hour) ? '' : 'bar-dim'}`} />}
              </g>
            );
          })}
        </svg>
        <div className="chart-x chart-x-hours">
          {byHour.map((b) => (
            <span key={b.hour}>{b.hour % 3 === 0 ? b.hour : ''}</span>
          ))}
        </div>
        <Tip tip={tip} />
      </div>
    </div>
  );
}

function WindowBand({ start, hours, W, H }) {
  const seg = (s, n) => <rect key={s} x={s * 20} y="0" width={n * 20} height={H} className="win-band" />;
  if (start + hours <= 24) return seg(start, hours);
  return (
    <>
      {seg(start, 24 - start)}
      {seg(0, start + hours - 24)}
    </>
  );
}

/* ---------- Тепловая карта: день недели × час ---------- */

export function Heatmap({ heat }) {
  const [tip, setTip] = useState(null);
  const max = Math.max(0, ...heat.flat());
  if (max <= 0) return <Empty icon="grid">Карта появится после первых поступлений</Empty>;
  const steps = [0.12, 0.3, 0.5, 0.72, 0.95];
  const level = (v) => (v <= 0 ? -1 : Math.min(4, Math.floor((v / max) * 5 - 1e-9)));
  return (
    <div className="heat" onMouseLeave={() => setTip(null)}>
      <div className="heat-grid">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="heat-h">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {heat.map((row, d) => (
          <Row key={d} d={d} row={row} level={level} steps={steps} setTip={setTip} />
        ))}
      </div>
      <div className="heat-legend">
        <span>меньше</span>
        {steps.map((s) => (
          <i key={s} style={{ '--a': s }} />
        ))}
        <span>больше</span>
      </div>
      {tip && (
        <div className="heat-tip">
          <b>{tip.title}</b> · в среднем {money(tip.v)}
        </div>
      )}
    </div>
  );
}

function Row({ d, row, level, steps, setTip }) {
  return (
    <>
      <span className="heat-d">{WEEKDAYS[d]}</span>
      {row.map((v, h) => {
        const l = level(v);
        return (
          <i
            key={h}
            className="heat-cell"
            style={{ '--a': l < 0 ? 0 : steps[l] }}
            onMouseEnter={() => setTip({ title: `${WEEKDAYS[d]}, ${hh(h)}–${hh((h + 1) % 24)}`, v })}
            title={`${WEEKDAYS[d]} ${hh(h)}: ${money(v)}`}
          />
        );
      })}
    </>
  );
}

/* ---------- Сегодня против среднего дня (накопительно) ---------- */

export function CurveChart({ curve, height = 170 }) {
  const [hover, setHover] = useState(null);
  const today = curve?.today || [];
  const avg = curve?.avg;
  const max = niceMax(Math.max(1, ...today.filter((v) => v != null), ...(avg || [])));
  const W = 480;
  const H = height;
  const x = (h) => ((h + 0.5) / 24) * W;
  const y = (v) => H - (v / max) * (H - 8);
  const line = (arr) =>
    arr
      .map((v, h) => (v == null ? null : `${x(h)},${y(v)}`))
      .filter(Boolean)
      .join(' ');
  const lastH = useMemo(() => today.reduce((m, v, h) => (v != null ? h : m), -1), [today]);
  if (lastH < 0) return <Empty icon="chart">Сегодня ещё нет данных</Empty>;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-y">
        {[1, 0.5, 0].map((f) => (
          <span key={f} style={{ top: `${(1 - f) * 100}%` }}>
            {axisFmt(max * f)}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ height: H }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(23, Math.floor(((e.clientX - r.left) / r.width) * 24))));
          }}
        >
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={H - (H - 8) * f} y2={H - (H - 8) * f} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          {avg && <polyline points={line(avg)} className="curve-avg" vectorEffect="non-scaling-stroke" />}
          <polygon points={`${x(0)},${H} ${line(today)} ${x(lastH)},${H}`} className="curve-area" />
          <polyline points={line(today)} className="curve-today" vectorEffect="non-scaling-stroke" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="crosshair" vectorEffect="non-scaling-stroke" />}
        </svg>
        <span className="curve-dot" style={{ left: `${((lastH + 0.5) / 24) * 100}%`, top: y(today[lastH]) }} />
        <div className="chart-x chart-x-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h}>{h % 3 === 0 ? h : ''}</span>
          ))}
        </div>
        {hover != null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / 24) * 100}%`, top: 0 }}>
            <b>к {hh((hover + 1) % 24)}</b>
            <div>Сегодня: {today[hover] != null ? money(today[hover]) : '—'}</div>
            {avg && <div>Средний день: {money(avg[hover])}</div>}
          </div>
        )}
      </div>
      <div className="legend">
        <span>
          <i className="lg-today" /> Сегодня
        </span>
        {avg && (
          <span>
            <i className="lg-avg" /> Средний день периода
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Прибыль против зарплат по дням ---------- */

export function MoneyChart({ series, height = 190 }) {
  const [tip, setTip] = useState(null);
  const pts = series.points;
  const max = niceMax(Math.max(0, ...pts.map((p) => Math.max(p.profit, p.pay))));
  if (!pts.length || pts.every((p) => !p.profit && !p.pay)) return <Empty icon="bars">Нет данных за период</Empty>;
  const W = Math.max(pts.length * 26, 300);
  const H = height;
  const step = W / pts.length;
  const bw = Math.min(14, step * 0.36);
  const labelEvery = Math.ceil(pts.length / 12);
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="chart-y">
        {[1, 0.5, 0].map((f) => (
          <span key={f} style={{ top: `${(1 - f) * 100}%` }}>
            {axisFmt(max * f)}
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          {pts.map((p, i) => {
            const hp = (Math.max(0, p.profit) / max) * H;
            const hc = (Math.max(0, p.pay) / max) * H;
            const x = i * step + step / 2;
            return (
              <g
                key={p.key}
                onMouseEnter={() =>
                  setTip({
                    x: ((i + 0.5) / pts.length) * 100,
                    y: 0,
                    title: series.mode === 'month' ? pointLabel(p.key, 'month') : dayLabel(p.key, { day: 'numeric', month: 'long', weekday: 'short' }),
                    lines: [`Прибыль: ${money(p.profit)}`, `Зарплаты: ${money(p.pay)}`, `Остаётся: ${money(p.net)}`],
                  })
                }
              >
                <rect x={i * step} y="0" width={step} height={H} fill="transparent" />
                {hp > 0 && <path d={roundTop(x - bw - 1, H - hp, bw, hp, 3)} className="bar" />}
                {hc > 0 && <path d={roundTop(x + 1, H - hc, bw, hc, 3)} className="bar bar-pay" />}
              </g>
            );
          })}
        </svg>
        <div className="chart-x">
          {pts.map((p, i) => (
            <span key={p.key} style={{ visibility: i % labelEvery === 0 ? 'visible' : 'hidden' }}>
              {pointLabel(p.key, series.mode)}
            </span>
          ))}
        </div>
        <Tip tip={tip} />
      </div>
      <div className="legend">
        <span>
          <i className="lg-today" /> Прибыль
        </span>
        <span>
          <i className="lg-pay" /> Зарплаты
        </span>
      </div>
    </div>
  );
}

/* ---------- Средняя прибыль по дням недели ---------- */

export function WeekdayBars({ byWeekday }) {
  const max = Math.max(0, ...byWeekday.map((d) => d.avg));
  if (max <= 0) return <Empty icon="calendar">Пока нет данных</Empty>;
  const best = byWeekday.reduce((b, d) => (d.avg > b.avg ? d : b), byWeekday[0]);
  return (
    <div className="hbars">
      {byWeekday.map((d) => (
        <div key={d.dow} className={`hbar ${d.dow === best.dow ? 'best' : ''}`}>
          <span className="hbar-l">{WEEKDAYS[d.dow]}</span>
          <div className="hbar-track">
            <i style={{ width: `${(d.avg / max) * 100}%` }} />
          </div>
          <span className="hbar-v">{money(Math.round(d.avg))}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Из чего состоит фонд зарплаты ---------- */

export function PayBreakdown({ m }) {
  const parts = [
    { k: 'base', label: 'Оклады', v: m.base, cls: 'pb-base' },
    { k: 'percent', label: '% с прибыли', v: m.percent, cls: 'pb-pct' },
    { k: 'bonuses', label: 'Бонусы', v: m.bonuses, cls: 'pb-bonus' },
  ].filter((p) => p.v > 0);
  const sum = parts.reduce((s, p) => s + p.v, 0);
  if (!sum) return <Empty icon="wallet">Начислений за период нет</Empty>;
  return (
    <div className="pb">
      <div className="pb-bar">
        {parts.map((p) => (
          <i key={p.k} className={p.cls} style={{ width: `${(p.v / sum) * 100}%` }} title={`${p.label}: ${money(p.v)}`} />
        ))}
      </div>
      <ul className="pb-legend">
        {parts.map((p) => (
          <li key={p.k}>
            <i className={p.cls} /> {p.label} <b>{money(p.v)}</b> <span className="muted">{Math.round((p.v / sum) * 100)}%</span>
          </li>
        ))}
        {m.fines > 0 && (
          <li>
            <i className="pb-fine" /> Штрафы <b className="neg">−{money(m.fines)}</b>
          </li>
        )}
        {m.corrections ? (
          <li>
            <i className="pb-fine" /> Ручные правки <b className={m.corrections > 0 ? 'pos' : 'neg'}>{m.corrections > 0 ? '+' : '−'}{money(Math.abs(m.corrections))}</b>
          </li>
        ) : null}
        <li className="pb-total">
          Итого начислено <b>{money(m.payroll)}</b>
        </li>
      </ul>
    </div>
  );
}
