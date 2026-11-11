import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ABSENCE_REASONS, DAY_STATES, PERIODS, initials } from '../lib.js';

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  calendar:
    '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="M7.5 13.5h.01M12 13.5h.01M16.5 13.5h.01M7.5 17h.01M12 17h.01"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 15 4-4 3 3 6-7"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 8h-5a3 3 0 0 0 0 6h5V8Z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14.2-1.5 7.3 5-3 5 3-1.5-7.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  up: '<path d="m5 12 7-7 7 7M12 19V5"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  slash: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  wand: '<path d="m15 4-1 1M19 8l1-1M17 3v2M21 6h-2M3 21l12-12M14.5 7.5l2 2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  sparkle: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
};

export function Icon({ name, size = 20, stroke = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/* ---------- Тосты ---------- */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={18} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Модальное окно (на телефоне — нижний лист) ---------- */

// Открытые окна складываются стопкой: Escape закрывает только верхнее.
const modalStack = [];

export function Modal({ title, sub, onClose, children, wide }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const entry = {};
    modalStack.push(entry);
    const onKey = (e) => e.key === 'Escape' && modalStack.at(-1) === entry && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(entry), 1);
      if (!modalStack.length) document.body.classList.remove('no-scroll');
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-grab" aria-hidden="true" />
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
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
  return (
    <div className="skeleton-wrap" aria-label="Загрузка">
      <div className="skeleton skeleton-lg" />
      <div className="skeleton-row">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="skeleton skeleton-md" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <Icon name="alert" size={18} />
      <span>{error}</span>
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = 'sparkle', children }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <div>{children}</div>
    </div>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Section({ title, aside, children }) {
  return (
    <section className="section">
      {(title || aside) && (
        <div className="section-head">
          <h2>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Avatar({ name, size = 'md' }) {
  return <span className={`avatar avatar-${size}`}>{initials(name)}</span>;
}

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`seg ${value === o.value ? `seg-on ${o.tone ? `seg-${o.tone}` : ''}` : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Выбор периода ---------- */

export function PeriodPicker({ value, onChange, keys }) {
  const list = keys ?? Object.keys(PERIODS);
  return (
    <div className="period">
      <div className="select-wrap">
        <Icon name="calendar" size={16} />
        <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} aria-label="Период">
          {list.map((k) => (
            <option key={k} value={k}>
              {PERIODS[k].label}
            </option>
          ))}
        </select>
      </div>
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

/* ---------- Плитки и статусы ---------- */

export function Kpi({ label, value, sub, delta, tone, icon }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {(sub || delta) && (
        <div className="kpi-sub">
          {delta}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// Изменение к прошлому периоду: стрелка + знак + подпись, цвет — только дополнительный канал.
export function Delta({ value, prev, invert, suffix = 'к прошлому периоду' }) {
  if (prev == null || value == null) return null;
  if (prev === 0) return value === 0 ? null : <span className="delta delta-flat">новые данные</span>;
  const change = ((value - prev) / Math.abs(prev)) * 100;
  const up = change >= 0;
  const good = invert ? !up : up;
  const shown = Math.abs(change) >= 100 ? Math.round(Math.abs(change)) : Math.round(Math.abs(change) * 10) / 10;
  return (
    <span className={`delta ${Math.abs(change) < 0.5 ? 'delta-flat' : good ? 'delta-good' : 'delta-bad'}`} title={suffix}>
      <Icon name={up ? 'up' : 'down'} size={13} stroke={2.5} />
      {String(shown).replace('.', ',')}%<span className="delta-note"> {suffix}</span>
    </span>
  );
}

export function StatusPill({ state }) {
  const s = DAY_STATES[state] ?? DAY_STATES.planned;
  return (
    <span className={`pill pill-${s.tone}`}>
      <span className="pill-dot" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export function ReasonPicker({ value, onChange, autoFocus }) {
  return (
    <div className="reason">
      <div className="chips">
        {ABSENCE_REASONS.map((r) => (
          <button type="button" key={r} className={`chip ${value === r ? 'chip-on' : ''}`} onClick={() => onChange(r)}>
            {r}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={300}
        placeholder="Или напишите свою причину"
        autoFocus={autoFocus}
        aria-label="Причина невыхода"
      />
    </div>
  );
}

export function Confirm({ title, text, action = 'Удалить', onConfirm, onClose, busy }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{text}</p>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {action}
        </button>
      </div>
    </Modal>
  );
}
