import { useState } from 'react';
import { api, useApi, money, dateTime } from '../lib.js';
import { Empty, ErrorBox, Field, Icon, Loading, MoneyInput, PageHead, Section, useToast } from '../components/ui.jsx';
import { ADV_STATUS } from './admin/Payroll.jsx';

const QUICK = [0.25, 0.5, 1];

export function AdvancesPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/me/advances', { refreshMs: 30000 });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const pending = data.items.find((a) => a.status === 'pending');
  const max = Math.max(0, Math.floor(data.balance));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/me/advances', { method: 'POST', body: { amount, reason } });
      toast('Заявка отправлена администратору');
      setAmount('');
      setReason('');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (a) => {
    if (!confirm(`Отменить заявку на аванс ${money(a.amount)}?`)) return;
    try {
      await api(`/me/advances/${a.id}/cancel`, { method: 'POST' });
      toast('Заявка отменена');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <PageHead title="Аванс" subtitle="Попросите часть уже заработанной зарплаты раньше дня выплаты" />

      <div className="card adv-hero">
        <span className="muted small">Можно запросить до</span>
        <b>{money(max)}</b>
        <span className="muted small">это сумма, которую вы уже заработали и ещё не получили</span>
      </div>

      {pending ? (
        <div className="card adv adv-pending">
          <div className="adv-top">
            <div>
              <div className="eyebrow">Ваша заявка</div>
              <b className="adv-big">{money(pending.amount)}</b>
              <div className="muted small">отправлена {dateTime(pending.createdAt)}</div>
            </div>
            <span className="tag tag-warn">⏳ ждёт решения</span>
          </div>
          {pending.reason && <div className="adv-reason">«{pending.reason}»</div>}
          <button className="btn btn-sm" onClick={() => cancel(pending)}>
            <Icon name="x" size={15} /> Передумал — отменить
          </button>
        </div>
      ) : (
        <form className="card form" onSubmit={submit}>
          <div className="card-title">Новая заявка</div>
          <Field label="Сумма, сом">
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`до ${max}`} />
          </Field>
          {max > 0 && (
            <div className="quick-chips">
              {QUICK.map((k) => (
                <button key={k} type="button" className="chip" onClick={() => setAmount(String(Math.floor(max * k)))}>
                  {k === 1 ? 'Всё' : `${k * 100}%`} · {money(Math.floor(max * k))}
                </button>
              ))}
            </div>
          )}
          <Field label="На что (необязательно)">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Например: аренда, лечение…" />
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy || !amount.trim() || max <= 0}>
            <Icon name="send" size={17} /> Отправить заявку
          </button>
          {max <= 0 && <p className="muted small">Пока нечего запрашивать — заработанная сумма уже выплачена.</p>}
          <p className="muted small">После одобрения сумма будет вычтена из вашей зарплаты к выплате.</p>
        </form>
      )}

      <Section title="История заявок">
        {data.items.length === 0 ? (
          <Empty icon="wallet">Вы ещё не запрашивали аванс</Empty>
        ) : (
          <ul className="card list">
            {data.items.map((a) => (
              <li key={a.id}>
                <div>
                  <b>{money(a.amount)}</b>
                  <div className="muted small">
                    {dateTime(a.createdAt)}
                    {a.reason && ` · ${a.reason}`}
                    {a.decisionNote && ` · ответ: «${a.decisionNote}»`}
                  </div>
                </div>
                <span className={`tag tag-${ADV_STATUS[a.status].tone}`}>
                  {ADV_STATUS[a.status].icon} {a.status === 'cancelled' ? 'отменён' : ADV_STATUS[a.status].label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
