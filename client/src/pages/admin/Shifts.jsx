import { useState } from 'react';
import { api, useApi, usePeriod, periodQuery, money, hours, date, time, toLocalInput, fromLocalInput } from '../../lib.js';
import { ErrorBox, Empty, Field, Icon, Loading, Modal, MoneyInput, PeriodPicker, useToast } from '../../components/ui.jsx';

export function AdminShifts() {
  const [period, setPeriod] = usePeriod('admin-shifts');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const users = useApi('/admin/users');
  const shifts = useApi(`/admin/shifts?${periodQuery(period, { userId, status })}`);
  const operators = (users.data || []).filter((u) => u.role === 'operator' && u.active);

  const list = shifts.data || [];
  const closed = list.filter((s) => !s.open);
  const sumProfit = closed.reduce((a, s) => a + s.profit, 0);
  const sumPay = closed.reduce((a, s) => a + s.earnings, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Смены</h1>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="filters">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {(users.data || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Все смены</option>
          <option value="open">Открытые</option>
          <option value="closed">Закрытые</option>
        </select>
      </div>
      <ErrorBox error={shifts.error} onRetry={shifts.reload} />
      {list.length > 0 && (
        <div className="summary-line">
          {closed.length} закрытых · прибыль <b>{money(sumProfit)}</b> · начислено <b>{money(sumPay)}</b>
        </div>
      )}
      {shifts.loading && !shifts.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>Смен за период нет</Empty>
      ) : (
        <ul className="list">
          {list.map((s) => (
            <li key={s.id}>
              <button className="list-row list-btn" onClick={() => setEditing(s)}>
                <div>
                  <div className="list-title">
                    {s.open && <span className="dot" />} {s.userName}
                  </div>
                  <div className="muted small">
                    {date(s.startAt)} {time(s.startAt)}–{s.open ? 'идёт' : time(s.endAt)}
                    {s.hours != null && ` · ${hours(s.hours)}`}
                  </div>
                  {s.note && <div className="muted small">{s.note}</div>}
                </div>
                <div className="list-right">
                  {s.open ? (
                    <span className="tag tag-live">на смене</span>
                  ) : (
                    <>
                      <div>{money(s.profit)}</div>
                      <div className="muted small">ЗП {money(s.earnings)}</div>
                    </>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="fab" onClick={() => setEditing({})} aria-label="Добавить смену">
        <Icon name="plus" size={26} />
      </button>

      {editing && (
        <ShiftModal
          shift={editing}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            shifts.reload();
          }}
        />
      )}
    </div>
  );
}

function ShiftModal({ shift, operators, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !shift.id;
  const [f, setF] = useState(() => ({
    userId: shift.userId ?? '',
    startAt: toLocalInput(shift.startAt) || toLocalInput(new Date(Date.now() - 8 * 3600000).toISOString()),
    endAt: shift.id ? toLocalInput(shift.endAt) || (shift.open ? toLocalInput(new Date().toISOString()) : '') : toLocalInput(new Date().toISOString()),
    profit: shift.profit ?? '',
    note: shift.note ?? '',
    hourlyRate: shift.hourlyRate ?? '',
    shiftRate: shift.shiftRate ?? '',
    percent: shift.percent ?? '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const pickUser = (e) => {
    const u = operators.find((o) => String(o.id) === e.target.value);
    setF({ ...f, userId: e.target.value, hourlyRate: u?.hourlyRate ?? '', shiftRate: u?.shiftRate ?? '', percent: u?.percent ?? '' });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      startAt: fromLocalInput(f.startAt),
      endAt: fromLocalInput(f.endAt),
      profit: f.profit === '' ? null : f.profit,
      note: f.note,
    };
    for (const k of ['hourlyRate', 'shiftRate', 'percent']) if (f[k] !== '') body[k] = f[k];
    if (isNew) body.userId = f.userId;
    try {
      await api(isNew ? '/admin/shifts' : `/admin/shifts/${shift.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? 'Смена добавлена' : 'Смена сохранена');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Удалить смену? Это действие нельзя отменить.')) return;
    try {
      await api(`/admin/shifts/${shift.id}`, { method: 'DELETE' });
      toast('Смена удалена');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'Новая смена' : `Смена: ${shift.userName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {isNew && (
          <Field label="Сотрудник *">
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
        <div className="row2">
          <Field label="Начало *">
            <input type="datetime-local" value={f.startAt} onChange={set('startAt')} required />
          </Field>
          <Field label="Конец" hint="Пусто — смена ещё идёт">
            <input type="datetime-local" value={f.endAt} onChange={set('endAt')} />
          </Field>
        </div>
        <Field label={`Прибыль, ₽${f.endAt ? ' *' : ''}`}>
          <MoneyInput value={f.profit} onChange={set('profit')} required={Boolean(f.endAt)} />
        </Field>
        <Field label="Комментарий">
          <input value={f.note} onChange={set('note')} maxLength={500} />
        </Field>
        <details className="details">
          <summary>Ставки для этой смены</summary>
          <div className="row3">
            <Field label="За смену, ₽">
              <MoneyInput value={f.shiftRate} onChange={set('shiftRate')} />
            </Field>
            <Field label="В час, ₽">
              <MoneyInput value={f.hourlyRate} onChange={set('hourlyRate')} />
            </Field>
            <Field label="% прибыли">
              <MoneyInput value={f.percent} onChange={set('percent')} />
            </Field>
          </div>
          <p className="muted small">По умолчанию берутся текущие ставки сотрудника.</p>
        </details>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Удалить
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {shift.open ? 'Сохранить / закрыть' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
