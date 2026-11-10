import { useState } from 'react';
import { api, useApi, usePeriod, periodQuery, money, date, todayKey } from '../../lib.js';
import { ErrorBox, Empty, Field, Icon, Loading, Modal, MoneyInput, PeriodPicker, useToast } from '../../components/ui.jsx';

export function AdminAdjustments() {
  const [period, setPeriod] = usePeriod('admin-adjustments');
  const [userId, setUserId] = useState('');
  const [editing, setEditing] = useState(null);
  const users = useApi('/admin/users');
  const list = useApi(`/admin/adjustments?${periodQuery(period, { userId })}`);
  const operators = (users.data || []).filter((u) => u.role === 'operator');
  const rows = list.data || [];
  const bonuses = rows.filter((a) => a.kind === 'bonus').reduce((s, a) => s + a.amount, 0);
  const fines = rows.filter((a) => a.kind === 'fine').reduce((s, a) => s + a.amount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Бонусы и штрафы</h1>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="filters">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {operators.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {rows.length > 0 && (
        <div className="summary-line">
          Бонусы <b className="pos">+{money(bonuses)}</b> · штрафы <b className="neg">−{money(fines)}</b>
        </div>
      )}
      {list.loading && !list.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>За период записей нет</Empty>
      ) : (
        <ul className="list">
          {rows.map((a) => (
            <li key={a.id}>
              <button className="list-row list-btn" onClick={() => setEditing(a)}>
                <div>
                  <div className="list-title">{a.userName}</div>
                  <div className="muted small">
                    {date(a.date)} · {a.kind === 'bonus' ? 'бонус' : 'штраф'}
                    {a.reason && ` · ${a.reason}`}
                  </div>
                </div>
                <div className={`list-right ${a.kind === 'bonus' ? 'pos' : 'neg'}`}>
                  {a.kind === 'bonus' ? '+' : '−'}
                  {money(a.amount)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="fab" onClick={() => setEditing({})} aria-label="Добавить бонус или штраф">
        <Icon name="plus" size={26} />
      </button>

      {editing && (
        <AdjustmentModal
          item={editing}
          operators={operators.filter((u) => u.active)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function AdjustmentModal({ item, operators, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !item.id;
  const [f, setF] = useState({
    userId: item.userId ?? '',
    kind: item.kind ?? 'bonus',
    amount: item.amount ?? '',
    reason: item.reason ?? '',
    date: item.date ? new Date(item.date).toLocaleDateString('sv-SE') : todayKey(),
    notify: true,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // Дата хранится как полдень выбранного дня по местному времени.
    const body = { ...f, date: new Date(`${f.date}T12:00`).toISOString() };
    try {
      await api(isNew ? '/admin/adjustments' : `/admin/adjustments/${item.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast('Сохранено');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Удалить запись?')) return;
    try {
      await api(`/admin/adjustments/${item.id}`, { method: 'DELETE' });
      toast('Запись удалена');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'Бонус или штраф' : `${item.kind === 'bonus' ? 'Бонус' : 'Штраф'}: ${item.userName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={f.kind === 'bonus' ? 'seg-on seg-good' : ''} onClick={() => setF({ ...f, kind: 'bonus' })}>
            Бонус
          </button>
          <button type="button" className={f.kind === 'fine' ? 'seg-on seg-bad' : ''} onClick={() => setF({ ...f, kind: 'fine' })}>
            Штраф
          </button>
        </div>
        {isNew && (
          <Field label="Сотрудник *">
            <select value={f.userId} onChange={set('userId')} required>
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
          <Field label="Сумма, сом *">
            <MoneyInput value={f.amount} onChange={set('amount')} required />
          </Field>
          <Field label="Дата *">
            <input type="date" value={f.date} onChange={set('date')} required />
          </Field>
        </div>
        <Field label="Причина">
          <input value={f.reason} onChange={set('reason')} maxLength={300} placeholder="За что" />
        </Field>
        {isNew && (
          <label className="check">
            <input type="checkbox" checked={f.notify} onChange={set('notify')} />
            Отправить сотруднику уведомление
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Удалить
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}
