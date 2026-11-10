import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi, money, hours, duration, dateTime, time, todayKey, periodQuery, plural } from '../lib.js';
import { ErrorBox, Field, Loading, Modal, MoneyInput, Stat, useToast, Icon } from '../components/ui.jsx';
import { useUnread } from '../App.jsx';

export function PaydayBanner() {
  const { items } = useUnread();
  const today = todayKey();
  const next = items
    .filter((n) => n.kind === 'payday' && n.paydayDate && n.paydayDate >= today)
    .sort((a, b) => (a.paydayDate < b.paydayDate ? -1 : 1))[0];
  if (!next) return null;
  const days = Math.round((new Date(`${next.paydayDate}T00:00`) - new Date(`${today}T00:00`)) / 86400000);
  const when = days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  return (
    <Link to="/notifications" className="banner">
      <Icon name="calendar" />
      <div>
        <b>День выдачи зарплаты — {when}</b>
        <div>{new Date(`${next.paydayDate}T00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
      </div>
    </Link>
  );
}

function Timer({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <div className="timer">{duration(now - Date.parse(since))}</div>;
}

export function ShiftPage() {
  const toast = useToast();
  const current = useApi('/shifts/current');
  const summary = useApi(`/me/summary?${periodQuery({ key: 'month' })}`);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      await api('/shifts/open', { method: 'POST' });
      toast('Смена открыта. Хорошей работы!');
      current.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onClosed = (s) => {
    setClosing(false);
    toast(`Смена закрыта. Заработано: ${money(s.earnings)}`);
    current.reload();
    summary.reload();
  };

  if (current.loading && !current.data) return <Loading />;
  const shift = current.data;
  const t = summary.data?.totals;

  return (
    <div className="page">
      <PaydayBanner />
      <ErrorBox error={current.error} onRetry={current.reload} />

      <section className={`card shift-card ${shift ? 'shift-on' : ''}`}>
        {shift ? (
          <>
            <div className="shift-status">
              <span className="dot" /> Смена идёт
            </div>
            <Timer since={shift.startAt} />
            <div className="muted">Начало: {dateTime(shift.startAt)}</div>
            <button className="btn btn-danger btn-block btn-lg" onClick={() => setClosing(true)}>
              Закрыть смену
            </button>
          </>
        ) : (
          <>
            <div className="shift-status">Смена не открыта</div>
            <p className="muted">Нажмите, когда начнёте работу. Время начала зафиксируется автоматически.</p>
            <button className="btn btn-primary btn-block btn-lg" onClick={open} disabled={busy}>
              {busy ? 'Открываем…' : 'Открыть смену'}
            </button>
          </>
        )}
      </section>

      <h2 className="section-title">Этот месяц</h2>
      {t ? (
        <div className="stats">
          <Stat label="Заработано" value={money(t.total)} accent="primary" />
          <Stat label="Прибыль" value={money(t.profit)} />
          <Stat label="Смен" value={t.shifts} />
          <Stat label="Отработано" value={hours(t.hours)} />
        </div>
      ) : (
        <ErrorBox error={summary.error} onRetry={summary.reload} />
      )}

      {summary.data?.shifts.length > 0 && (
        <>
          <h2 className="section-title">Последние смены</h2>
          <ul className="list">
            {summary.data.shifts
              .filter((s) => !s.open)
              .slice(0, 5)
              .map((s) => (
                <li key={s.id} className="list-row">
                  <div>
                    <div className="list-title">{new Date(s.startAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
                    <div className="muted small">
                      {time(s.startAt)}–{time(s.endAt)} · {hours(s.hours)}
                    </div>
                  </div>
                  <div className="list-right">
                    <div>{money(s.earnings)}</div>
                    <div className="muted small">прибыль {money(s.profit)}</div>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      {closing && <CloseShiftModal shift={shift} onClose={() => setClosing(false)} onDone={onClosed} />}
    </div>
  );
}

function CloseShiftModal({ shift, onClose, onDone }) {
  const [profit, setProfit] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (profit.trim() === '') return setError('Укажите прибыль за смену — это обязательно');
    setBusy(true);
    setError('');
    try {
      onDone(await api('/shifts/close', { method: 'POST', body: { profit, note } }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Закрытие смены" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted">
          Смена с {dateTime(shift.startAt)}. Внесите прибыль, которую вы сделали за смену.
        </p>
        <Field label="Прибыль за смену, сом *">
          <MoneyInput value={profit} onChange={(e) => setProfit(e.target.value)} autoFocus required />
        </Field>
        <Field label="Комментарий">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Необязательно" />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-danger btn-block btn-lg" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Закрыть смену'}
        </button>
      </form>
    </Modal>
  );
}
