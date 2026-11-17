import { useState } from 'react';
import { api, useApi, addDays, todayKey, dayLabel, plural, WEEKDAYS, MONTHS_FULL } from '../lib.js';
import { Field, Icon, Modal, Seg, useToast } from './ui.jsx';

const MODES = [
  { value: 'week', label: 'Раз в неделю' },
  { value: 'twice', label: '2 раза в месяц' },
  { value: 'month', label: 'Раз в месяц' },
  { value: 'dates', label: 'По календарю' },
  { value: 'none', label: 'Без расписания' },
];
const WD_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const whenText = (d, today) => {
  const n = Math.round((new Date(`${d}T00:00`) - new Date(`${today}T00:00`)) / 86400000);
  return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
};

// Карточка «когда выдаём зарплату» с настройкой режима.
export function PaydayCard() {
  const { data, reload } = useApi('/admin/payday');
  const [edit, setEdit] = useState(false);
  if (!data) return null;
  const next = data.next[0];
  return (
    <div className={`card payday-card ${data.isToday ? 'is-today' : ''}`}>
      <div className="payday-main">
        <span className="payday-icon">📅</span>
        <div>
          <b>Выдача зарплаты: {data.text}</b>
          <div className="muted small">
            {next ? (
              <>
                {data.isToday ? <b className="warn-text">Сегодня день выдачи!</b> : <>Следующая — {dayLabel(next, { weekday: 'short', day: 'numeric', month: 'long' })} ({whenText(next, data.today)})</>}
                {data.next.length > 1 && ` · потом ${data.next.slice(data.isToday ? 1 : 1, 3).map((d) => dayLabel(d, { day: 'numeric', month: 'short' })).join(', ')}`}
              </>
            ) : data.mode === 'none' ? (
              'Выберите, как часто выдаёте зарплату — сотрудники увидят дату выдачи'
            ) : (
              'Ближайших дат нет — добавьте их в календаре'
            )}
          </div>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setEdit(true)}>
        <Icon name="settings" size={15} /> Настроить
      </button>
      {edit && <PaydayModal value={data} onClose={() => setEdit(false)} onSaved={() => (setEdit(false), reload())} />}
    </div>
  );
}

function PaydayModal({ value, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    mode: value.mode === 'none' ? 'week' : value.mode,
    weekday: value.weekday,
    monthDay: value.monthDay,
    monthDay2: value.monthDay2,
    dates: value.dates,
  });
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/payday', { method: 'PUT', body: f });
      toast('Режим выдачи сохранён');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  const num = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  return (
    <Modal title="Когда выдаём зарплату" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Seg value={f.mode} onChange={(mode) => setF({ ...f, mode })} options={MODES} />
        {f.mode === 'week' && (
          <Field label="День недели">
            <select value={f.weekday} onChange={num('weekday')}>
              {WD_FULL.map((w, i) => (
                <option key={w} value={i}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(f.mode === 'month' || f.mode === 'twice') && (
          <div className="row2">
            <Field label={f.mode === 'twice' ? 'Первое число' : 'Число месяца'} hint="31 — последний день месяца">
              <input type="number" min="1" max="31" value={f.monthDay} onChange={num('monthDay')} />
            </Field>
            {f.mode === 'twice' && (
              <Field label="Второе число">
                <input type="number" min="1" max="31" value={f.monthDay2} onChange={num('monthDay2')} />
              </Field>
            )}
          </div>
        )}
        {f.mode === 'dates' && <DatesPicker value={f.dates} onChange={(dates) => setF({ ...f, dates })} />}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => api('/admin/payday', { method: 'PUT', body: { mode: 'none' } }).then(onSaved)}>
            Без расписания
          </button>
          <button className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}

// Календарь: нажатием отмечаются дни выдачи.
function DatesPicker({ value, onChange }) {
  const today = todayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const set = new Set(value);
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const lead = (new Date(`${first}T12:00`).getDay() + 6) % 7;
  const len = new Date(y, m, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => addDays(first, i))];
  const toggle = (d) => {
    const next = new Set(set);
    next.has(d) ? next.delete(d) : next.add(d);
    onChange([...next].sort());
  };
  const upcoming = value.filter((d) => d >= today);
  return (
    <div className="dates-picker">
      <div className="sched-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий месяц">
          <Icon name="left" size={18} />
        </button>
        <div className="sched-title">
          {MONTHS_FULL[m - 1]} {y}
        </div>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц">
          <Icon name="chevron" size={18} />
        </button>
      </div>
      <div className="cal cal-small">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button type="button" key={d} className={`cal-day ${set.has(d) ? 'pay-on' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`} onClick={() => toggle(d)}>
              <span className="cal-n">{Number(d.slice(8))}</span>
              {set.has(d) && <span className="cal-k">💵</span>}
            </button>
          ) : (
            <span key={`e${i}`} />
          )
        )}
      </div>
      <div className="muted small">
        {upcoming.length
          ? `Впереди ${upcoming.length} ${plural(upcoming.length, 'день', 'дня', 'дней')} выдачи: ${upcoming.slice(0, 6).map((d) => dayLabel(d, { day: 'numeric', month: 'short' })).join(', ')}${upcoming.length > 6 ? '…' : ''}`
          : 'Нажмите на дни, когда выдаёте зарплату'}
      </div>
    </div>
  );
}
