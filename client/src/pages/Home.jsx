import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi, money, todayKey, addDays, plural, dayLabel, payModeText } from '../lib.js';
import { ErrorBox, Icon, Kpi, Loading, MoneyInput, Progress, Section, useToast } from '../components/ui.jsx';
import { EventFeed } from '../components/insights.jsx';
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
        <div>{dayLabel(next.paydayDate)}</div>
      </div>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

export function HomePage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/me/home', { refreshMs: 60000 });
  const t = data?.today;

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;

  const goalLeft = t.goal > 0 ? Math.max(0, t.goal - t.profit) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  const undo = async (e) => {
    try {
      await api(`/me/profit/${e.id}`, { method: 'DELETE' });
      toast('Запись отменена');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="greet">
        <div>
          <p className="muted">{dayLabel(todayKey(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>
            {greeting}, {data.user.name.split(' ')[0]}
          </h1>
        </div>
        <div className="greet-chips">
          {data.payday?.next && (
            <span className="chip" title={`Зарплата выдаётся ${data.payday.text}`}>
              💵 Зарплата {data.payday.next === t.date ? 'сегодня' : dayLabel(data.payday.next, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          )}
          {data.streak >= 2 && (
            <span className="chip chip-fire" title="Дней подряд с прибылью">
              🔥 {data.streak} {plural(data.streak, 'день', 'дня', 'дней')} подряд
            </span>
          )}
        </div>
      </div>
      {t.goal > 0 && t.profit >= t.goal && <Confetti day={t.date} />}
      <PaydayBanner />

      <div className="hero-grid">
        <section className="hero">
          <div className="hero-label">
            <Icon name="drop" size={16} /> Заработано сегодня
          </div>
          <div className="hero-value">{money(t.earned)}</div>
          <div className="hero-meta">
            {!t.work ? (
              <span>Сегодня выходной</span>
            ) : t.pending ? (
              <span>Заполните прибыль за смену — тогда начислится оклад {money(t.rate)}</span>
            ) : (
              <span>✅ Прибыль за смену заполнена</span>
            )}
            {data.user.payFixed && t.filled && <span>оклад {money(t.base)}</span>}
            {(data.user.payPercent || t.percentPay > 0) && <span>% от прибыли {money(t.percentPay)}</span>}
          </div>
        </section>

        <section className="card goal-card">
          <div className="eyebrow">Прибыль сегодня</div>
          <div className="goal-value">{money(t.profit)}</div>
          {t.goal > 0 ? (
            <>
              <Progress value={t.profit} max={t.goal} />
              <div className="muted small">
                {goalLeft > 0 ? (
                  <>
                    до цели {money(t.goal)} осталось <b>{money(goalLeft)}</b>
                  </>
                ) : (
                  <b className="pos">Цель дня выполнена 🎯</b>
                )}
              </div>
            </>
          ) : (
            <div className="muted small">{t.events ? `${t.events} ${plural(t.events, 'поступление', 'поступления', 'поступлений')}` : 'Поступлений ещё не было'}</div>
          )}
        </section>
      </div>

      <Section title={t.pending ? '⏳ Заполните прибыль за смену' : 'Прибыль за смену'}>
        <DayProfit today={t} onDone={reload} />
      </Section>

      <div className="kpis">
        <Kpi label="К выплате" icon="wallet" tone="accent" value={money(data.balance.balance)} sub={data.lastPayout ? `последняя выплата ${money(data.lastPayout.amount)} · ${dayLabel(data.lastPayout.date, { day: 'numeric', month: 'short' })}` : 'выплат ещё не было'} />
        <Kpi label="За 7 дней" icon="calendar" value={money(data.week.accrued)} sub={`прибыль ${money(data.week.profit)}`} />
        <Kpi label="За месяц" icon="coins" value={money(data.month.accrued)} sub={`прибыль ${money(data.month.profit)}`} />
        <Link to="/advances" className="kpi kpi-link">
          <div className="kpi-label">
            <Icon name="coins" size={15} /> Нужны деньги раньше?
          </div>
          <div className="kpi-value">Аванс →</div>
          <div className="kpi-sub">мои условия: {payModeText(data.user)}</div>
        </Link>
      </div>

      <Section title="Последние записи прибыли" aside={<Link to="/earnings" className="small">Вся зарплата</Link>}>
        <div className="card flush">
          <EventFeed events={data.events} onUndo={undo} empty="Записей пока нет — заполните прибыль за смену" />
        </div>
      </Section>
    </div>
  );
}

// Сотрудник вносит итог прибыли за смену (сегодня или за прошлые дни недели).
// После заполнения начисляются оклад за смену и процент.
function DayProfit({ today, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState(today.date);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!amount.trim()) return;
    setBusy(true);
    try {
      await api('/me/day-profit', { method: 'PUT', body: { date, amount } });
      setAmount('');
      onDone();
      toast(`Прибыль за ${date === today.date ? 'сегодня' : dayLabel(date, { day: 'numeric', month: 'long' })} сохранена`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card form" onSubmit={submit}>
      <p className="muted small">
        Впишите <b>итог прибыли за смену</b>. Если за день уже что-то вносили — сумма заменится на новую. Нет прибыли — впишите 0.
      </p>
      <div className="quick quick-2">
        <input type="date" value={date} max={today.date} min={addDays(today.date, -7)} onChange={(e) => setDate(e.target.value)} aria-label="День" />
        <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Прибыль, сом" aria-label="Прибыль" />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || !amount.trim()}>
        Сохранить прибыль
      </button>
    </form>
  );
}

// Конфетти один раз в день, когда выполнена дневная цель.
function Confetti({ day }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const key = `confetti:${day}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {}
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 4200);
    return () => clearTimeout(t);
  }, [day]);
  if (!show) return null;
  const colors = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#14b8a6'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 70 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${Math.random() * 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${Math.random() * 0.8}s`,
            animationDuration: `${2.4 + Math.random() * 1.6}s`,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
      <div className="confetti-msg">🎯 Цель дня выполнена!</div>
    </div>
  );
}
