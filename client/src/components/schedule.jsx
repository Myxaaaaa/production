import { useState } from 'react';
import {
  DAY_STATES,
  WEEKDAYS,
  api,
  dayFull,
  dayMonth,
  dateTime,
  hours,
  money,
  monthDays,
  todayKey,
  weekdayIdx,
} from '../lib.js';
import { Confirm, Field, Icon, Modal, MoneyInput, ReasonPicker, Segmented, StatusPill, useToast } from './ui.jsx';

export const timeRange = (d) => `${d.startTime}–${d.endTime}`;
const shortRange = (d) => `${d.startTime.slice(0, 2)}–${d.endTime.slice(0, 2)}`;

export function ScheduleLegend({ states = ['planned', 'active', 'done', 'needs_profit', 'absent'] }) {
  return (
    <ul className="legend" aria-label="Обозначения">
      {states.map((s) => (
        <li key={s}>
          <span className={`legend-swatch tone-${DAY_STATES[s].tone}`} aria-hidden="true" />
          {DAY_STATES[s].label}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Календарь сотрудника на месяц ---------- */

export function MonthCalendar({ month, days, today, onPick }) {
  const map = new Map(days.map((d) => [d.date, d]));
  const keys = monthDays(month);
  const lead = weekdayIdx(keys[0]);
  return (
    <div className="cal">
      <div className="cal-head" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i > 4 ? 'is-weekend' : ''}>
            {w}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {keys.map((k) => {
          const d = map.get(k);
          const tone = d ? DAY_STATES[d.state].tone : 'off';
          return (
            <button
              key={k}
              type="button"
              className={`cal-day tone-${tone} ${k === today ? 'is-today' : ''}`}
              onClick={() => d && onPick(d)}
              disabled={!d}
              aria-label={`${dayMonth(k)}: ${d ? `${DAY_STATES[d.state].label}, ${timeRange(d)}` : 'выходной'}`}
            >
              <span className="cal-num">{Number(k.slice(8))}</span>
              {d && <span className="cal-mark">{d.status === 'absent' ? <Icon name="x" size={12} stroke={3} /> : shortRange(d)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Карточка дня для сотрудника ---------- */

export function DaySheet({ day, initialMode = null, onClose, onChanged }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialMode);
  const [profit, setProfit] = useState(day.profit ?? '');
  const [note, setNote] = useState(day.note ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const future = day.date > todayKey();

  const run = async (fn, message) => {
    setBusy(true);
    setError('');
    try {
      const updated = await fn();
      toast(message);
      onChanged(updated);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const saveProfit = (e) => {
    e.preventDefault();
    if (String(profit).trim() === '') return setError('Укажите прибыль за смену');
    run(() => api(`/me/days/${day.id}/profit`, { method: 'PUT', body: { profit, note } }), 'Прибыль сохранена');
  };
  const markAbsent = (e) => {
    e.preventDefault();
    if (reason.trim().length < 2) return setError('Укажите причину');
    run(() => api(`/me/days/${day.id}/absence`, { method: 'POST', body: { reason } }), 'Отметка сохранена, администратор её увидит');
  };
  const unmark = () => run(() => api(`/me/days/${day.id}/absence`, { method: 'DELETE' }), 'Отметка снята');

  return (
    <Modal title={dayFull(day.date)} sub={`${timeRange(day)} · ${hours(day.hours)}`} onClose={onClose}>
      <div className="day-sheet">
        <div className="day-facts">
          <StatusPill state={day.state} />
          {day.status === 'work' && (
            <div className="day-fact">
              <span>{day.earnings != null ? 'Заработано' : 'Заработок по ставке'}</span>
              <b>{money(day.earnings ?? day.expectedEarnings)}</b>
            </div>
          )}
          {day.profit != null && (
            <div className="day-fact">
              <span>Прибыль</span>
              <b>{money(day.profit)}</b>
            </div>
          )}
        </div>

        {day.status === 'absent' && (
          <div className="callout callout-bad">
            <Icon name="slash" size={18} />
            <div>
              <b>{day.absenceReason}</b>
              <div className="small muted">
                Отметил{day.absenceBySelf ? 'и вы' : `: ${day.absenceByName ?? 'администратор'}`} · {dateTime(day.absenceAt)}
              </div>
            </div>
          </div>
        )}
        {day.note && day.status === 'work' && <p className="muted small">Комментарий: {day.note}</p>}

        {mode === 'profit' && (
          <form className="form" onSubmit={saveProfit}>
            <Field label="Прибыль за смену, сом">
              <MoneyInput value={profit} onChange={(e) => setProfit(e.target.value)} autoFocus />
            </Field>
            <Field label="Комментарий">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Необязательно" />
            </Field>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>
                Назад
              </button>
              <button className="btn btn-primary" disabled={busy}>
                Сохранить
              </button>
            </div>
          </form>
        )}

        {mode === 'absent' && (
          <form className="form" onSubmit={markAbsent}>
            <Field label={future ? 'Почему не сможете выйти?' : 'Почему не вышли?'}>
              <ReasonPicker value={reason} onChange={setReason} />
            </Field>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode(null)}>
                Назад
              </button>
              <button className="btn btn-danger" disabled={busy}>
                Отметить невыход
              </button>
            </div>
          </form>
        )}

        {!mode && (
          <div className="day-actions">
            {day.canEditProfit && (
              <button className="btn btn-primary btn-lg" onClick={() => setMode('profit')}>
                <Icon name="coins" size={18} />
                {day.profit == null ? 'Внести прибыль' : 'Изменить прибыль'}
              </button>
            )}
            {day.canMarkAbsent && (
              <button className="btn btn-soft-bad btn-lg" onClick={() => setMode('absent')}>
                <Icon name="slash" size={18} />
                {future ? 'Не смогу выйти' : 'Я не вышел(а)'}
              </button>
            )}
            {day.canUnmarkAbsent && (
              <button className="btn btn-ghost btn-lg" onClick={unmark} disabled={busy}>
                Отменить отметку — выйду
              </button>
            )}
            {!day.canEditProfit && !day.canMarkAbsent && !day.canUnmarkAbsent && (
              <p className="muted small center">Изменить этот день может администратор.</p>
            )}
            {error && <div className="alert alert-error">{error}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- День графика для администратора ---------- */

export function AdminDayModal({ day, operators = [], onClose, onSaved }) {
  const toast = useToast();
  const isNew = !day.id;
  const presetUser = operators.find((u) => u.id === day.userId);
  const [f, setF] = useState(() => ({
    userId: day.userId ?? '',
    date: day.date ?? todayKey(),
    startTime: day.startTime ?? presetUser?.defaultStart ?? '10:00',
    endTime: day.endTime ?? presetUser?.defaultEnd ?? '22:00',
    status: day.status ?? 'work',
    absenceReason: day.absenceReason ?? '',
    profit: day.profit ?? '',
    note: day.note ?? '',
    shiftRate: day.shiftRate ?? '',
    hourlyRate: day.hourlyRate ?? '',
    percent: day.percent ?? '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const pickUser = (e) => {
    const u = operators.find((o) => String(o.id) === e.target.value);
    setF({ ...f, userId: e.target.value, startTime: u?.defaultStart ?? f.startTime, endTime: u?.defaultEnd ?? f.endTime });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (f.status === 'absent' && f.absenceReason.trim().length < 2) return setError('Укажите причину невыхода');
    setBusy(true);
    setError('');
    const body = { date: f.date, startTime: f.startTime, endTime: f.endTime, status: f.status, note: f.note };
    if (f.status === 'absent') body.absenceReason = f.absenceReason;
    else body.profit = f.profit === '' ? null : f.profit;
    for (const k of ['hourlyRate', 'shiftRate', 'percent']) if (f[k] !== '') body[k] = f[k];
    if (isNew) body.userId = f.userId;
    try {
      await api(isNew ? '/admin/days' : `/admin/days/${day.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? 'Смена добавлена в график' : 'Сохранено');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/admin/days/${day.id}`, { method: 'DELETE' });
      toast('Смена убрана из графика');
      onSaved();
    } catch (err) {
      setConfirm(false);
      setError(err.message);
      setBusy(false);
    }
  };

  const name = day.userName ?? presetUser?.name;
  return (
    <Modal
      title={isNew ? 'Смена в графике' : name}
      sub={isNew ? (name ? `${name} · ${dayFull(f.date)}` : null) : `${dayFull(day.date)} · ${timeRange(day)}`}
      onClose={onClose}
    >
      <form className="form" onSubmit={submit}>
        {!isNew && <StatusPill state={day.state} />}
        {isNew && !presetUser && (
          <Field label="Сотрудник">
            <select value={f.userId} onChange={pickUser} required>
              <option value="">— выберите —</option>
              {operators.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="row3">
          <Field label="Дата">
            <input type="date" value={f.date} onChange={set('date')} required />
          </Field>
          <Field label="Начало">
            <input type="time" value={f.startTime} onChange={set('startTime')} required />
          </Field>
          <Field label="Конец" hint={f.endTime <= f.startTime ? 'на следующий день' : null}>
            <input type="time" value={f.endTime} onChange={set('endTime')} required />
          </Field>
        </div>

        <Segmented
          value={f.status}
          onChange={(status) => setF({ ...f, status })}
          options={[
            { value: 'work', label: 'Работает', icon: 'check' },
            { value: 'absent', label: 'Не вышел', icon: 'slash', tone: 'bad' },
          ]}
        />

        {f.status === 'absent' ? (
          <Field label="Причина невыхода" hint="Сотрудник получит уведомление об отметке">
            <ReasonPicker value={f.absenceReason} onChange={(absenceReason) => setF({ ...f, absenceReason })} />
          </Field>
        ) : (
          <div className="row2">
            <Field label="Прибыль, сом" hint="Пусто — ещё не внесена">
              <MoneyInput value={f.profit} onChange={set('profit')} />
            </Field>
            <Field label="Комментарий">
              <input value={f.note} onChange={set('note')} maxLength={500} />
            </Field>
          </div>
        )}
        {f.status === 'absent' && day.profit != null && (
          <div className="alert alert-warn">
            <Icon name="alert" size={18} />
            <span>Внесённая прибыль {money(day.profit)} будет удалена.</span>
          </div>
        )}

        <details className="details">
          <summary>Ставки для этой смены</summary>
          <div className="row3">
            <Field label="За смену, сом">
              <MoneyInput value={f.shiftRate} onChange={set('shiftRate')} placeholder="как у сотрудника" />
            </Field>
            <Field label="В час, сом">
              <MoneyInput value={f.hourlyRate} onChange={set('hourlyRate')} placeholder="как у сотрудника" />
            </Field>
            <Field label="% прибыли">
              <MoneyInput value={f.percent} onChange={set('percent')} placeholder="как у сотрудника" />
            </Field>
          </div>
        </details>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirm(true)}>
              Убрать из графика
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
      {confirm && (
        <Confirm
          title="Убрать смену из графика?"
          text={`${name}, ${dayMonth(day.date)}. Смена исчезнет из графика и статистики${day.profit != null ? ' вместе с внесённой прибылью' : ''}.`}
          action="Убрать"
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(false)}
        />
      )}
    </Modal>
  );
}
