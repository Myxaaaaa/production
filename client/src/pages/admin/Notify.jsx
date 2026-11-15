import { useState } from 'react';
import { api, useApi, dateTime, dayLabel } from '../../lib.js';
import { Empty, ErrorBox, Field, Icon, PageHead, Section, Seg, useToast } from '../../components/ui.jsx';

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
    setF({
      ...f,
      kind: 'payday',
      paydayDate: f.paydayDate || d.toLocaleDateString('sv-SE'),
      title: 'Скоро день выдачи зарплаты',
      body: f.body || 'Проверьте в разделе «Заработок», что вся прибыль внесена.',
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
      <PageHead title="Рассылка" subtitle="Сообщения всем или конкретному сотруднику">
        <button className="btn btn-ghost" onClick={paydayTemplate}>
          <Icon name="calendar" size={17} /> Шаблон «день зарплаты»
        </button>
      </PageHead>
      <div className="two-col">
        <form className="card form" onSubmit={submit}>
          <Seg
            value={f.kind}
            onChange={(kind) => setF({ ...f, kind })}
            options={[
              { value: 'info', label: 'Сообщение' },
              { value: 'payday', label: 'День зарплаты' },
            ]}
          />
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
            <Field label="Дата выдачи зарплаты *" hint="Сотрудники увидят напоминание на главной до этой даты">
              <input type="date" value={f.paydayDate} onChange={set('paydayDate')} required />
            </Field>
          )}
          <Field label="Заголовок *">
            <input value={f.title} onChange={set('title')} required maxLength={120} />
          </Field>
          <Field label="Текст">
            <textarea value={f.body} onChange={set('body')} rows={4} maxLength={2000} />
          </Field>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              <Icon name="send" size={16} /> Отправить
            </button>
          </div>
        </form>

        <Section title="Отправленные">
          <ErrorBox error={sent.error} onRetry={sent.reload} />
          {sent.data?.length === 0 ? (
            <Empty icon="send">Пока ничего не отправлено</Empty>
          ) : (
            <ul className="card list">
              {(sent.data || []).map((n) => (
                <li key={n.id}>
                  <div>
                    <b>{n.title}</b>
                    {n.paydayDate && <div className="small">Выдача: {dayLabel(n.paydayDate)}</div>}
                    {n.body && <div className="muted small clamp">{n.body}</div>}
                    <div className="muted small">
                      {n.targetName ? `→ ${n.targetName}` : '→ всем'} · {dateTime(n.createdAt)} · прочитали {n.reads} из {n.recipients}
                    </div>
                  </div>
                  <button className="icon-btn" onClick={() => remove(n)} aria-label="Удалить">
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
