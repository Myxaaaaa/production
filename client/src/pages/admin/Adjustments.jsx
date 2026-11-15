import { useState } from 'react';
import { api, useApi, periodQuery, money, todayKey } from '../../lib.js';
import { Avatar, Empty, ErrorBox, Field, Icon, Loading, Modal, MoneyInput, Seg, useToast } from '../../components/ui.jsx';

export function AdjustmentsPanel({ period }) {
  const [userId, setUserId] = useState('');
  const [editing, setEditing] = useState(null);
  const users = useApi('/admin/users');
  const list = useApi(`/admin/adjustments?${periodQuery(period, { userId })}`);
  const operators = (users.data || []).filter((u) => u.role === 'operator');
  const rows = list.data || [];
  const bonuses = rows.filter((a) => a.kind === 'bonus').reduce((s, a) => s + a.amount, 0);
  const fines = rows.filter((a) => a.kind === 'fine').reduce((s, a) => s + a.amount, 0);

  return (
    <>
      <div className="filters">
        <select className="select-pill" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {operators.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={17} /> Бонус или штраф
        </button>
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {rows.length > 0 && (
        <div className="summary">
          <span>
            Бонусы <b className="pos">+{money(bonuses)}</b>
          </span>
          <span>
            штрафы <b className="neg">−{money(fines)}</b>
          </span>
        </div>
      )}
      {list.loading && !list.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon="gift">За период записей нет</Empty>
      ) : (
        <ul className="card list">
          {rows.map((a) => (
            <li key={a.id} className="clickable" onClick={() => setEditing(a)}>
              <div className="user-cell">
                <Avatar name={a.userName} size="sm" />
                <div>
                  <b>{a.userName}</b>
                  <div className="muted small">
                    {new Date(a.date).toLocaleDateString('ru-RU')} · {a.kind === 'bonus' ? 'бонус' : 'штраф'}
                    {a.reason && ` · ${a.reason}`}
                  </div>
                </div>
              </div>
              <b className={a.kind === 'bonus' ? 'pos' : 'neg'}>
                {a.kind === 'bonus' ? '+' : '−'}
                {money(a.amount)}
              </b>
            </li>
          ))}
        </ul>
      )}

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
    </>
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
        <Seg
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind })}
          options={[
            { value: 'bonus', label: 'Бонус' },
            { value: 'fine', label: 'Штраф' },
          ]}
        />
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
            <button type="button" className="btn btn-ghost danger-text" onClick={remove}>
              <Icon name="trash" size={16} /> Удалить
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
