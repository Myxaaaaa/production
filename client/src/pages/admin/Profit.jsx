import { useState } from 'react';
import { api, useApi, usePeriod, periodQuery, money, useStored, toLocalInput, fromLocalInput } from '../../lib.js';
import { ErrorBox, Field, Icon, Loading, Modal, MoneyInput, PageHead, PeriodPicker, useToast } from '../../components/ui.jsx';
import { EventFeed, SOURCE } from '../../components/insights.jsx';

export function AdminProfit() {
  const [period, setPeriod] = usePeriod('admin-profit', 'today');
  const [userId, setUserId] = useStored('admin-profit-user', '');
  const [source, setSource] = useStored('admin-profit-source', '');
  const [editing, setEditing] = useState(null);
  const users = useApi('/admin/users');
  const q = periodQuery(period, { userId, source });
  const list = useApi(`/admin/events?${q}`, { refreshMs: 20000 });
  const operators = (users.data || []).filter((u) => u.role === 'operator');
  const rows = list.data || [];
  const total = rows.reduce((s, e) => s + e.amount, 0);
  const pay = rows.reduce((s, e) => s + e.pay, 0);

  return (
    <div className="page">
      <PageHead title="Поступления" subtitle="Каждое изменение прибыли — с расширения, вручную или от администратора">
        <a className="btn btn-ghost" href={`/api/admin/events.csv?${periodQuery(period, { userId })}`} download>
          <Icon name="file" size={17} /> CSV
        </a>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={17} /> Добавить
        </button>
      </PageHead>
      <div className="filters">
        <PeriodPicker value={period} onChange={setPeriod} />
        <select className="select-pill" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
          <option value="">Все сотрудники</option>
          {operators.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className="select-pill" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Источник">
          <option value="">Любой источник</option>
          {Object.entries(SOURCE).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {rows.length > 0 && (
        <div className="summary">
          <span>
            {rows.length} записей · прибыль <b>{money(total)}</b>
          </span>
          <span>
            сотрудникам по % <b>{money(Math.round(pay * 100) / 100)}</b>
          </span>
        </div>
      )}
      {list.loading && !list.data ? (
        <Loading />
      ) : (
        <div className="card flush">
          <EventFeed events={rows} showUser onEdit={setEditing} empty="За период поступлений нет" />
        </div>
      )}

      {editing && (
        <EventModal
          item={editing}
          operators={operators}
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

function EventModal({ item, operators, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !item.id;
  const [f, setF] = useState({
    userId: item.userId ?? '',
    amount: item.amount ?? '',
    at: toLocalInput(item.at || new Date().toISOString()),
    percent: item.percent ?? '',
    note: item.note ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...f, at: fromLocalInput(f.at) };
    if (body.percent === '') delete body.percent;
    try {
      await api(isNew ? '/admin/events' : `/admin/events/${item.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast('Сохранено');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Удалить запись о прибыли? Зарплата сотрудника пересчитается.')) return;
    try {
      await api(`/admin/events/${item.id}`, { method: 'DELETE' });
      toast('Запись удалена');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'Новое поступление' : `Поступление: ${item.userName}`} subtitle={!isNew && `источник: ${SOURCE[item.source]?.label}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {isNew && (
          <Field label="Сотрудник *">
            <select value={f.userId} onChange={set('userId')} required>
              <option value="">— выберите —</option>
              {operators
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <div className="row2">
          <Field label="Прибыль, сом *" hint="Минус — исправление">
            <MoneyInput value={f.amount} onChange={set('amount')} required autoFocus={isNew} />
          </Field>
          <Field label="Время *">
            <input type="datetime-local" value={f.at} onChange={set('at')} required />
          </Field>
        </div>
        <Field label="% сотруднику" hint={isNew ? 'Пусто — текущий процент сотрудника' : 'Процент зафиксирован в момент поступления'}>
          <MoneyInput value={f.percent} onChange={set('percent')} placeholder="авто" />
        </Field>
        <Field label="Комментарий">
          <input value={f.note} onChange={set('note')} maxLength={300} />
        </Field>
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
