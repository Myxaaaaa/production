import { useState } from 'react';
import { api, useApi, dateTime, dayMonth, addDays, todayKey } from '../../lib.js';
import { Confirm, Empty, ErrorBox, Field, Icon, PageHead, Section, Segmented, useToast } from '../../components/ui.jsx';

const EMPTY = { kind: 'info', title: '', body: '', paydayDate: '', targetUserId: '' };

export function AdminNotify() {
  const toast = useToast();
  const users = useApi('/admin/users');
  const sent = useApi('/admin/notifications');
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const setKind = (kind) => {
    if (kind === 'payday') {
      setF({
        ...f,
        kind,
        paydayDate: f.paydayDate || addDays(todayKey(), 3),
        title: f.title || 'Скоро день выдачи зарплаты',
        body: f.body || 'Пожалуйста, проверьте, что прибыль за все смены внесена.',
      });
    } else setF({ ...f, kind });
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

  const remove = async () => {
    try {
      await api(`/admin/notifications/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      sent.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <PageHead title="Рассылка" sub="Сообщения появятся у сотрудников в разделе «Сообщения»" />
      <form className="card card-pad form" onSubmit={submit}>
        <Segmented
          value={f.kind}
          onChange={setKind}
          options={[
            { value: 'info', label: 'Сообщение', icon: 'bell' },
            { value: 'payday', label: 'День зарплаты', icon: 'wallet' },
          ]}
        />
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
          {f.kind === 'payday' && (
            <Field label="Дата выдачи зарплаты" hint="Напоминание будет на главном экране до этой даты">
              <input type="date" value={f.paydayDate} onChange={set('paydayDate')} required />
            </Field>
          )}
        </div>
        <Field label="Заголовок">
          <input value={f.title} onChange={set('title')} required maxLength={120} />
        </Field>
        <Field label="Текст">
          <textarea value={f.body} onChange={set('body')} rows={3} maxLength={2000} />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            <Icon name="send" size={18} /> Отправить
          </button>
        </div>
      </form>

      <Section title="Отправленные">
        <ErrorBox error={sent.error} onRetry={sent.reload} />
        {sent.data?.length === 0 ? (
          <Empty icon="send">Пока ничего не отправлено</Empty>
        ) : (
          <ul className="list card">
            {(sent.data || []).map((n) => (
              <li key={n.id} className="list-row">
                <span className={`list-icon ${n.kind === 'payday' ? 'tone-accent' : ''}`}>
                  <Icon name={n.kind === 'payday' ? 'wallet' : n.kind === 'bonus' ? 'gift' : n.kind === 'fine' ? 'alert' : 'bell'} size={18} />
                </span>
                <div className="list-main">
                  <div className="list-title">{n.title}</div>
                  {n.paydayDate && <div className="list-sub">Выдача: {dayMonth(n.paydayDate)}</div>}
                  {n.body && <div className="list-sub clamp">{n.body}</div>}
                  <div className="list-sub">
                    {n.targetName ? `→ ${n.targetName}` : '→ всем'} · {dateTime(n.createdAt)} · прочитали {n.reads} из {n.recipients}
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setRemoving(n)} aria-label="Удалить">
                  <Icon name="x" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {removing && (
        <Confirm
          title="Удалить уведомление?"
          text={`«${removing.title}» исчезнет у сотрудников.`}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
