import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi, addDays, todayKey, moneyShort, money, plural, dayLabel, WEEKDAYS, MONTHS_FULL } from '../lib.js';
import { Field, Icon, Loading, MoneyInput, Seg, useToast } from './ui.jsx';

// Что можно поставить на день.
// По умолчанию каждый день — смена; администратор ставит выходной, невыход, больничный или отпуск.
export const DAY_KIND = {
  work: { label: 'Смена', short: '', cls: 'k-plan', icon: '💼' },
  off: { label: 'Выходной', short: 'выходной', cls: 'k-off', icon: '🌙' },
  absent: { label: 'Невыход', short: 'невыход', cls: 'k-absent', icon: '🚫' },
  sick: { label: 'Больничный', short: 'больничн.', cls: 'k-sick', icon: '🤒' },
  vacation: { label: 'Отпуск', short: 'отпуск', cls: 'k-vac', icon: '🏖️' },
};
// Кнопки: «Смена» снимает отметку и возвращает обычную смену.
const ACTIONS = [
  { kind: null, ...DAY_KIND.work },
  ...['off', 'absent', 'sick', 'vacation'].map((k) => ({ kind: k, ...DAY_KIND[k] })),
];

// Чередование смен: [рабочих, выходных].
const PATTERNS = {
  all: { label: 'Подряд', cycle: null },
  '2/2': { label: '2/2', cycle: [2, 2] },
  '3/3': { label: '3/3', cycle: [3, 3] },
  '5/2': { label: '5/2', cycle: [5, 2] },
  '1/1': { label: 'Через день', cycle: [1, 1] },
  '1/2': { label: 'Сутки/двое', cycle: [1, 2] },
};

const dow = (d) => (new Date(`${d}T12:00`).getDay() + 6) % 7;
const monthOf = (d) => d.slice(0, 7);
function shiftMonth(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthGrid(m) {
  const first = `${m}-01`;
  const [y, mm] = m.split('-').map(Number);
  const last = `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`;
  return { from: addDays(first, -dow(first)), to: addDays(last, 6 - dow(last)) };
}
function between(a, b) {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const out = [];
  for (let d = s; d <= e; d = addDays(d, 1)) out.push(d);
  return out;
}

function dayClass(d) {
  if (d.kind && d.kind !== 'work') return DAY_KIND[d.kind]?.cls || 'k-off';
  if (d.before) return 'k-before';
  return 'k-plan';
}

// Календарь графика. Админ: зажмите и ведите пальцем/мышью, чтобы выделить сразу несколько дней,
// или задайте диапазон «с … по …». Сотрудник видит свой график только для чтения.
export function ScheduleCalendar({ userId, readOnly = false, onChanged }) {
  const toast = useToast();
  const [month, setMonth] = useState(monthOf(todayKey()));
  const grid = monthGrid(month);
  const url = readOnly && !userId ? `/me/schedule?from=${grid.from}&to=${grid.to}` : `/admin/schedule?userId=${userId}&from=${grid.from}&to=${grid.to}`;
  const { data, reload } = useApi(userId || readOnly ? url : null);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const gridRef = useRef(null);
  const drag = useRef(null);
  const today = todayKey();

  useEffect(() => setSel(new Set()), [userId]);

  const byDate = useMemo(() => new Map((data?.days || []).map((d) => [d.date, d])), [data]);

  // Выделение: «add» или «remove» в зависимости от того, с какого дня начали.
  const begin = (date) => {
    const mode = sel.has(date) ? 'remove' : 'add';
    drag.current = { anchor: date, base: new Set(sel), mode, last: date };
    apply(date);
  };
  const apply = (date) => {
    const g = drag.current;
    if (!g) return;
    g.last = date;
    const next = new Set(g.base);
    for (const d of between(g.anchor, date)) g.mode === 'add' ? next.add(d) : next.delete(d);
    setSel(next);
  };
  const end = () => {
    drag.current = null;
  };

  // Мышь: нажали и ведём.
  const onPointerDown = (e) => {
    if (readOnly || e.pointerType !== 'mouse' || e.button !== 0) return;
    const date = e.target.closest('[data-date]')?.dataset.date;
    if (!date) return;
    e.preventDefault();
    begin(date);
  };
  const onPointerOver = (e) => {
    if (!drag.current || e.pointerType !== 'mouse') return;
    const date = e.target.closest('[data-date]')?.dataset.date;
    if (date && date !== drag.current.last) apply(date);
  };
  useEffect(() => {
    const up = () => end();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  // Палец: короткое касание — выбрать день; зажать (≈0,3 с) и вести — выделить несколько.
  // Обычный свайп без задержки прокручивает страницу как обычно.
  useEffect(() => {
    const el = gridRef.current;
    if (!el || readOnly) return;
    let t = null;
    let start = null;
    let dragging = false;
    const dateAt = (touch) => document.elementFromPoint(touch.clientX, touch.clientY)?.closest?.('[data-date]')?.dataset.date;
    const onStart = (e) => {
      if (e.touches.length !== 1) return;
      const date = dateAt(e.touches[0]);
      if (!date) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, date };
      dragging = false;
      t = setTimeout(() => {
        dragging = true;
        t = null;
        navigator.vibrate?.(12);
        el.classList.add('dragging');
        beginRef.current(start.date);
      }, 280);
    };
    const onMove = (e) => {
      if (!start) return;
      const p = e.touches[0];
      if (!dragging) {
        if (t && Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) {
          clearTimeout(t);
          t = null;
          start = null;
        }
        return;
      }
      e.preventDefault();
      const date = dateAt(p);
      if (date && date !== drag.current?.last) applyRef.current(date);
    };
    const onEnd = (e) => {
      if (t) {
        clearTimeout(t);
        t = null;
        if (start) {
          e.preventDefault();
          beginRef.current(start.date);
          end();
        }
      }
      if (dragging) end();
      dragging = false;
      start = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [readOnly, data]);
  const beginRef = useRef(begin);
  const applyRef = useRef(apply);
  beginRef.current = begin;
  applyRef.current = apply;

  const save = async (groups, msg) => {
    setBusy(true);
    try {
      let n = 0;
      for (const g of groups) {
        if (!g.dates?.length && !g.from) continue;
        const r = await api('/admin/days', { method: 'PUT', body: { userId, ...g } });
        n += r.count || 0;
      }
      toast(msg ?? `Готово: ${n} ${plural(n, 'день', 'дня', 'дней')}`);
      setSel(new Set());
      reload();
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const markSelected = (kind) => {
    const dates = [...sel].sort();
    const label = kind ? DAY_KIND[kind].label.toLowerCase() : 'смена';
    save([{ dates, kind }], `${dates.length} ${plural(dates.length, 'день', 'дня', 'дней')}: ${label}`);
  };

  const weeks = [];
  if (data) {
    let row = [];
    for (let d = grid.from; d <= grid.to; d = addDays(d, 1)) {
      row.push(byDate.get(d) || { date: d });
      if (row.length === 7) {
        weeks.push(row);
        row = [];
      }
    }
  }
  const inMonth = (data?.days || []).filter((d) => monthOf(d.date) === month);
  const count = (fn) => inMonth.filter(fn).length;
  const [y, mm] = month.split('-').map(Number);

  return (
    <div className="sched">
      <div className="sched-head">
        <button type="button" className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Предыдущий месяц">
          <Icon name="left" size={18} />
        </button>
        <div className="sched-title">
          {MONTHS_FULL[mm - 1]} {y}
        </div>
        <button type="button" className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Следующий месяц">
          <Icon name="chevron" size={18} />
        </button>
        {month !== monthOf(today) && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMonth(monthOf(today))}>
            Сегодня
          </button>
        )}
        {!readOnly && (
          <button type="button" className={`btn btn-sm ${showRange ? 'btn-primary' : ''} sched-range-btn`} onClick={() => setShowRange(!showRange)}>
            <Icon name="calendar" size={15} /> С … по …
          </button>
        )}
      </div>

      {!readOnly && showRange && <RangeForm month={month} busy={busy} onApply={save} onSelect={(dates) => setSel(new Set(dates))} />}

      {!data ? (
        <Loading rows={2} />
      ) : (
        <>
          <div className="sched-stats">
            <span>
              <b>{count((d) => d.work)}</b> {plural(count((d) => d.work), 'смена', 'смены', 'смен')}
            </span>
            {['off', 'absent', 'sick', 'vacation'].map((k) =>
              count((d) => d.kind === k) > 0 ? (
                <span key={k}>
                  {DAY_KIND[k].icon} {count((d) => d.kind === k)} {DAY_KIND[k].label.toLowerCase()}
                </span>
              ) : null
            )}
            {count((d) => d.pending) > 0 && <span className="warn-text">⏳ {count((d) => d.pending)} без прибыли</span>}
            {inMonth.some((d) => d.profit) && <span>прибыль {money(inMonth.reduce((s, d) => s + d.profit, 0))}</span>}
          </div>
          <div
            ref={gridRef}
            className={`cal ${readOnly ? 'cal-ro' : ''}`}
            onPointerDown={onPointerDown}
            onPointerOver={onPointerOver}
            onContextMenu={(e) => !readOnly && e.preventDefault()}
          >
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={`cal-wd ${i >= 5 ? 'we' : ''}`}>
                {w}
              </span>
            ))}
            {weeks.flat().map((d) => (
              <div
                key={d.date}
                data-date={readOnly ? undefined : d.date}
                className={`cal-day ${dayClass(d)} ${monthOf(d.date) !== month ? 'out' : ''} ${d.date === today ? 'today' : ''} ${sel.has(d.date) ? 'sel' : ''} ${d.date < today ? 'past' : ''} ${d.pending ? 'pend' : ''}`}
                title={`${dayLabel(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${d.note ? ` · ${d.note}` : ''}`}
              >
                <span className="cal-n">{Number(d.date.slice(8))}</span>
                {d.kind && d.kind !== 'work' ? <span className="cal-k">{DAY_KIND[d.kind]?.short}</span> : null}
                {d.pending ? <span className="cal-p cal-wait">⏳</span> : d.filled || d.profit ? <span className="cal-p">{moneyShort(d.profit)}</span> : null}
              </div>
            ))}
          </div>
          <div className="cal-legend">
            {Object.entries(DAY_KIND).map(([k, v]) => (
              <span key={k}>
                <i className={v.cls} /> {v.label}
              </span>
            ))}
            <span>⏳ прибыль не заполнена</span>
          </div>
          {!readOnly && !sel.size && (
            <p className="muted small sched-help">
              <Icon name="info" size={14} />
              <span>
                Нажмите на день — сможете вписать прибыль или поменять смену. Чтобы выбрать сразу несколько — <b>зажмите и проведите</b> по дням (на телефоне — подержите палец полсекунды и ведите). Или нажмите «С … по …».
              </span>
            </p>
          )}
        </>
      )}

      {!readOnly && sel.size > 0 && (
        <div className="sched-bar">
          <div className="sched-bar-top">
            <b>
              Выбрано {sel.size} {plural(sel.size, 'день', 'дня', 'дней')}
            </b>
            <button type="button" className="link" onClick={() => setSel(new Set())}>
              Снять выделение
            </button>
          </div>
          {sel.size === 1 && [...sel][0] <= today && (
            <DayProfitForm key={[...sel][0]} userId={userId} day={byDate.get([...sel][0]) || { date: [...sel][0] }} onSaved={() => (setSel(new Set()), reload(), onChanged?.())} />
          )}
          <div className="sched-actions">
            {ACTIONS.map((v) => (
              <button
                key={v.label}
                type="button"
                className={`btn btn-sm kind-btn ${v.cls} ${sel.size === 1 && (byDate.get([...sel][0])?.kind ?? null) === v.kind ? 'on' : ''}`}                 disabled={busy}
                onClick={() => markSelected(v.kind)}
              >
                <span>{v.icon}</span> {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Прибыль за выбранный день: после сохранения начисляются оклад за смену и процент.
function DayProfitForm({ userId, day, onSaved }) {
  const toast = useToast();
  const [amount, setAmount] = useState(day.filled || day.profit ? String(day.profit) : '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!amount.trim()) return;
    setBusy(true);
    try {
      await api('/admin/day-profit', { method: 'PUT', body: { userId, date: day.date, amount } });
      toast(`Прибыль за ${dayLabel(day.date, { day: 'numeric', month: 'long' })} сохранена`);
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="day-profit" onSubmit={submit}>
      <label className="field-label">
        Прибыль за {dayLabel(day.date, { day: 'numeric', month: 'long' })}
        {day.pending && <span className="warn-text"> · ждёт заполнения</span>}
      </label>
      <div className="quick">
        <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сумма, сом (0 — без прибыли)" />
        <button className="btn btn-primary" disabled={busy || !amount.trim()}>
          Сохранить
        </button>
      </div>
      {(day.filled || day.profit) ? <div className="muted small">Сейчас: {money(day.profit)} · заработок за день {money(day.total)}</div> : null}
    </form>
  );
}

function RangeForm({ month, busy, onApply, onSelect }) {
  const t = todayKey();
  const [f, setF] = useState(() => {
    const from = monthOf(t) === month ? t : `${month}-01`;
    return { from, to: addDays(from, 13), kind: 'off', pattern: 'all' };
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = f.from && f.to && f.from <= f.to;
  const days = valid ? between(f.from, f.to) : [];
  const cycle = f.kind === 'work' ? PATTERNS[f.pattern].cycle : null;
  const split = () => {
    if (!cycle) return { work: days, off: [] };
    const [w, o] = cycle;
    const work = [];
    const off = [];
    days.forEach((d, i) => ((i % (w + o)) < w ? work : off).push(d));
    return { work, off };
  };
  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    if (days.length > 400) return;
    const kind = f.kind === 'work' ? null : f.kind;
    if (cycle) {
      const s = split();
      onApply(
        [
          { dates: s.work, kind: null },
          { dates: s.off, kind: 'off' },
        ],
        `График ${PATTERNS[f.pattern].label}: ${s.work.length} смен, ${s.off.length} выходных`
      );
    } else onApply([{ from: f.from, to: f.to, kind }]);
  };
  const s = split();
  return (
    <form className="range-form" onSubmit={submit}>
      <div className="row2">
        <Field label="С какого дня">
          <input type="date" value={f.from} onChange={set('from')} required />
        </Field>
        <Field label="По какой день">
          <input type="date" value={f.to} min={f.from} onChange={set('to')} required />
        </Field>
      </div>
      <div className="field">
        <span className="field-label">Что поставить</span>
        <Seg
          size="sm"
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind })}
          options={Object.entries(DAY_KIND).map(([value, v]) => ({ value, label: `${v.icon} ${v.label}` }))}
        />
      </div>
      {f.kind === 'work' && (
        <div className="field">
          <span className="field-label">Чередование смен и выходных</span>
          <Seg size="sm" value={f.pattern} onChange={(pattern) => setF({ ...f, pattern })} options={Object.entries(PATTERNS).map(([value, p]) => ({ value, label: p.label }))} />
        </div>
      )}
      {valid && (
        <div className="range-preview">
          {days.slice(0, 42).map((d) => (
            <i key={d} className={cycle ? (s.work.includes(d) ? 'k-plan' : 'k-off') : DAY_KIND[f.kind].cls} title={dayLabel(d)} />
          ))}
          {days.length > 42 && <span className="muted small">+{days.length - 42}</span>}
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" disabled={!valid} onClick={() => onSelect(days)}>
          Только выделить
        </button>
        <button className="btn btn-primary" disabled={busy || !valid || days.length > 400}>
          Применить к {days.length} {plural(days.length, 'дню', 'дням', 'дням')}
        </button>
      </div>
    </form>
  );
}
