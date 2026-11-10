import { useState } from 'react';
import { api, useApi, dateTime, date } from '../../lib.js';
import { ErrorBox, Empty, Field, useToast } from '../../components/ui.jsx';

const EMPTY = { kind: 'info', title: '', body: '', paydayDate: '', targetUserId: '' };

export function AdminNotify() {
  const toast = useToast();
  const users = useApi('/admin/users');
  const sent = useApi('/admin/notifications');
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const paydayTemplate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const iso = d.toLocaleDateString('sv-SE');
    setF({
      ...f,
      kind: 'payday',
      paydayDate: f.paydayDate || iso,
      title: 'Скоро день выдачи зарплаты',
      body: f.body || 'Пожалуйста, проверьте, что все смены закрыты и прибыль внесена.',
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/notifications', { method: 'POST', body: { ...f, targetUserId: f.targetUserId || null } });
      toast('Уведомление отправлено');
      setF(EMPTY);
      sent.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n) => {
    if (!confirm(`Удалить уведомление «${n.title}»? Сотрудники его больше не увидят.`)) return;
    try {
      await api(`/admin/notifications/${n.id}`, { method: 'DELETE' });
      sent.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Рассылка</h1>
        <button className="btn btn-ghost btn-sm" onClick={paydayTemplate}>
          Шаблон «день зарплаты»
        </button>
      </div>
      <form className="card form" onSubmit={submit}>
        <div className="row2">
          <Field label="Кому">
            <select value={f.targetUserId} onChange={set('targetUserId')}>
              <option value="">Всем сотрудникам</option>
              {(users.data || [])
                .filter((u) => u.role === 'operator' && u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Тип">
            <select value={f.kind} onChange={set('kind')}>
              <option value="info">Обычное сообщение</option>
              <option value="payday">День выдачи зарплаты</option>
            </select>
          </Field>
        </div>
        {f.kind === 'payday' && (
          <Field label="Дата выдачи зарплаты *" hint="Сотрудники увидят напоминание на главном экране до этой даты">
            <input type="date" value={f.paydayDate} onChange={set('paydayDate')} required />
          </Field>
        )}
        <Field label="Заголовок *">
          <input value={f.title} onChange={set('title')} required maxLength={120} />
        </Field>
        <Field label="Текст">
          <textarea value={f.body} onChange={set('body')} rows={3} maxLength={2000} />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          Отправить
        </button>
      </form>

      <h2 className="section-title">Отправленные</h2>
      <ErrorBox error={sent.error} onRetry={sent.reload} />
      {sent.data?.length === 0 ? (
        <Empty>Пока ничего не отправлено</Empty>
      ) : (
        <ul className="list">
          {(sent.data || []).map((n) => (
            <li key={n.id} className="list-row">
              <div>
                <div className="list-title">{n.title}</div>
                {n.paydayDate && <div className="small">Выдача: {date(`${n.paydayDate}T00:00`)}</div>}
                {n.body && <div className="muted small clamp">{n.body}</div>}
                <div className="muted small">
                  {n.targetName ? `→ ${n.targetName}` : '→ всем'} · {dateTime(n.createdAt)} · прочитали {n.reads} из {n.recipients}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => remove(n)}>
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
