import { useState } from 'react';
import { api, useApi, usePeriod, periodQuery, money, dayShort, todayKey } from '../../lib.js';
import {
  Avatar,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Kpi,
  Loading,
  Modal,
  MoneyInput,
  PageHead,
  PeriodPicker,
  Segmented,
  useToast,
} from '../../components/ui.jsx';

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
      <PageHead title="Бонусы и штрафы" sub="Сотрудник получает уведомление о начислении">
        <PeriodPicker value={period} onChange={setPeriod} />
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={18} /> Добавить
        </button>
      </PageHead>
      <div className="filters">
        <div className="select-wrap">
          <Icon name="user" size={16} />
          <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
            <option value="">Все сотрудники</option>
            {operators.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      <div className="kpis kpis-2">
        <Kpi label="Бонусы" value={`+${money(bonuses)}`} icon="gift" tone="good" />
        <Kpi label="Штрафы" value={`−${money(fines)}`} icon="alert" tone="bad" />
      </div>
      {list.loading && !list.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon="gift">За период записей нет</Empty>
      ) : (
        <ul className="list card">
          {rows.map((a) => (
            <li key={a.id}>
              <button className="list-row list-btn" onClick={() => setEditing(a)}>
                <Avatar name={a.userName} size="sm" />
                <div className="list-main">
                  <div className="list-title">{a.userName}</div>
                  <div className="list-sub">
                    {dayShort(a.date)} · {a.kind === 'bonus' ? 'бонус' : 'штраф'}
                    {a.reason && ` · ${a.reason}`}
                  </div>
                </div>
                <div className={`list-right ${a.kind === 'bonus' ? 'pos' : 'neg'}`}>
                  <b>
                    {a.kind === 'bonus' ? '+' : '−'}
                    {money(a.amount)}
                  </b>
                </div>
              </button>
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
    date: item.date ?? todayKey(),
    notify: true,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(isNew ? '/admin/adjustments' : `/admin/adjustments/${item.id}`, { method: isNew ? 'POST' : 'PUT', body: f });
      toast('Сохранено');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/admin/adjustments/${item.id}`, { method: 'DELETE' });
      toast('Запись удалена');
      onSaved();
    } catch (err) {
      setConfirm(false);
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Бонус или штраф' : `${item.kind === 'bonus' ? 'Бонус' : 'Штраф'}: ${item.userName}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Segmented
          value={f.kind}
          onChange={(kind) => setF({ ...f, kind })}
          options={[
            { value: 'bonus', label: 'Бонус', icon: 'gift', tone: 'good' },
            { value: 'fine', label: 'Штраф', icon: 'alert', tone: 'bad' },
          ]}
        />
        {isNew && (
          <Field label="Сотрудник">
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
          <Field label="Сумма, сом">
            <MoneyInput value={f.amount} onChange={set('amount')} required />
          </Field>
          <Field label="Дата">
            <input type="date" value={f.date} onChange={set('date')} required />
          </Field>
        </div>
        <Field label="Причина">
          <input value={f.reason} onChange={set('reason')} maxLength={300} placeholder="За что" />
        </Field>
        {isNew && (
          <label className="check">
            <input type="checkbox" checked={f.notify} onChange={set('notify')} />
            <span>Отправить сотруднику уведомление</span>
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirm(true)}>
              Удалить
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
      {confirm && <Confirm title="Удалить запись?" text="Сумма перестанет учитываться в зарплате." busy={busy} onConfirm={remove} onClose={() => setConfirm(false)} />}
    </Modal>
  );
}
