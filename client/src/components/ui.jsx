import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PERIODS, money, num, hours as fmtHours } from '../lib.js';

const ICONS = {
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  wallet: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  users:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
};

export function Icon({ name, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/* ---------- Уведомления-тосты ---------- */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Модальное окно (на телефоне — нижний лист) ---------- */

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function MoneyInput(props) {
  return <input type="text" inputMode="decimal" autoComplete="off" placeholder="0" {...props} />;
}

export function Loading() {
  return <div className="loading">Загрузка…</div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      {error}
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/* ---------- Выбор периода ---------- */

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="period">
      <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} aria-label="Период">
        {Object.entries(PERIODS).map(([k, p]) => (
          <option key={k} value={k}>
            {p.label}
          </option>
        ))}
      </select>
      {value.key === 'custom' && (
        <div className="period-custom">
          <input type="date" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="С" />
          <span>—</span>
          <input type="date" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="По" />
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, accent, sub }) {
  return (
    <div className={`stat ${accent ? `stat-${accent}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------- График прибыли ---------- */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function pointLabel(key, mode) {
  if (mode === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
  }
  const [, m, d] = key.split('-');
  return `${Number(d)}.${m}`;
}

export function BarChart({ series }) {
  const max = Math.max(1, ...series.points.map((p) => p.profit));
  if (!series.points.length) return <Empty>Нет данных за период</Empty>;
  return (
    <div className="chart-scroll">
      <div className="chart" style={{ minWidth: series.points.length * 30 }}>
        {series.points.map((p) => (
          <div key={p.key} className="chart-col" title={`${pointLabel(p.key, series.mode)}: ${money(p.profit)}, смен: ${p.shifts}`}>
            <div className="chart-bar-wrap">
              <div className="chart-bar" style={{ height: `${Math.max(0, (p.profit / max) * 100)}%` }} />
            </div>
            <div className="chart-label">{pointLabel(p.key, series.mode)}</div>
          </div>
        ))}
      </div>
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
  if (!rows.length) return <Empty>Пока нет сотрудников</Empty>;
  return (
    <>
      <div className="chips" role="tablist">
        {Object.entries(SORTS).map(([k, s]) => (
          <button key={k} className={`chip ${sort === k ? 'chip-on' : ''}`} onClick={() => setSort(k)}>
            {s.label}
          </button>
        ))}
      </div>
      <ol className="board">
        {sorted.map((r, i) => (
          <li key={r.userId} className={`board-row ${r.userId === meId ? 'board-me' : ''}`}>
            <span className={`rank rank-${i + 1}`}>{i + 1}</span>
            <div className="board-main">
              <div className="board-name">
                {r.name}
                {r.userId === meId && <span className="tag">вы</span>}
              </div>
              <div className="board-meta">
                {r.shifts} см. · {fmtHours(r.hours)} · {money(r.profitPerHour)}/ч
              </div>
              {withPay && (
                <div className="board-meta">
                  К выплате: <b>{money(r.total)}</b>
                  {r.bonuses > 0 && <span className="pos"> +{num(r.bonuses, 2)}</span>}
                  {r.fines > 0 && <span className="neg"> −{num(r.fines, 2)}</span>}
                </div>
              )}
            </div>
            <div className="board-value">{money(r.profit)}</div>
          </li>
        ))}
      </ol>
    </>
  );
}
