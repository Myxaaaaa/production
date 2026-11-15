import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi, money, todayKey, plural, useTicker, dayLabel, ago, payModeText } from '../lib.js';
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
  const { data, error, loading, reload } = useApi('/me/home', { refreshMs: 20000 });
  const [fetchedAt, setFetchedAt] = useState(0);
  const [lastData, setLastData] = useState(null);
  if (data !== lastData) {
    setLastData(data);
    setFetchedAt(Date.now());
  }
  const t = data?.today;
  const earned = useTicker(t?.earned ?? 0, t?.ratePerSecond ?? 0, fetchedAt);
  const balance = useTicker(data?.balance.balance ?? 0, t?.ratePerSecond ?? 0, fetchedAt);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;

  const perHour = (t.ratePerSecond || 0) * 3600;
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
          {data.streak >= 2 && (
            <span className="chip chip-fire" title="Дней подряд с прибылью">
              🔥 {data.streak} {plural(data.streak, 'день', 'дня', 'дней')} подряд
            </span>
          )}
          <ExtChip ext={data.ext} />
        </div>
      </div>
      {t.goal > 0 && t.profit >= t.goal && <Confetti day={t.date} />}
      <PaydayBanner />

      <div className="hero-grid">
        <section className="hero">
          <div className="hero-label">
            <Icon name="drop" size={16} /> Заработано сегодня
          </div>
          <div className="hero-value">{money(Math.floor(earned * 100) / 100)}</div>
          <div className="hero-meta">
            {!data.user.payFixed ? (
              <span>Оклад выключен — заработок идёт только с % от прибыли</span>
            ) : perHour > 0 ? (
              <span className="drip">
                <i /> капает {money(Math.round(perHour * 100) / 100)} в час
              </span>
            ) : (
              <span>Сегодня оклад не начисляется (выходной)</span>
            )}
            {data.user.payFixed && <span>оклад {money(Math.round((t.base + (earned - t.earned)) * 100) / 100)}</span>}
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

      <div className="kpis">
        <Kpi label="К выплате" icon="wallet" tone="accent" value={money(Math.floor(balance * 100) / 100)} sub={data.lastPayout ? `последняя выплата ${money(data.lastPayout.amount)} · ${dayLabel(data.lastPayout.date, { day: 'numeric', month: 'short' })}` : 'выплат ещё не было'} />
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

      <div className="two-col">
        <Section title="Изменения прибыли" aside={<Link to="/earnings" className="small">Все</Link>}>
          <div className="card flush">
            <EventFeed events={data.events} onUndo={undo} empty="Как только на рабочем сайте изменится сумма, она появится здесь" />
          </div>
        </Section>
        <Section title="Добавить вручную">
          <QuickAdd onDone={reload} />
        </Section>
      </div>
    </div>
  );
}

function ExtChip({ ext }) {
  if (ext.online)
    return (
      <Link to="/profile" className="chip chip-live">
        <i /> Расширение работает
      </Link>
    );
  if (ext.connected)
    return (
      <Link to="/profile" className="chip chip-warn" title={`Последний сигнал ${ago(ext.lastSeen)}`}>
        <Icon name="pause" size={14} /> Рабочая страница не открыта
      </Link>
    );
  return (
    <Link to="/profile" className="chip">
      <Icon name="puzzle" size={14} /> Подключить расширение
    </Link>
  );
}

function QuickAdd({ onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!amount.trim()) return;
    setBusy(true);
    try {
      const ev = await api('/me/profit', { method: 'POST', body: { amount, note } });
      setAmount('');
      setNote('');
      onDone();
      toast(`Добавлено ${money(ev.amount)}`, 'ok', {
        label: 'Отменить',
        run: () => api(`/me/profit/${ev.id}`, { method: 'DELETE' }).then(onDone, (err) => toast(err.message, 'error')),
      });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card form" onSubmit={submit}>
      <p className="muted small">Если прибыль пришла мимо рабочего сайта (наличные, перевод) — внесите её здесь. Минус — для исправления ошибки.</p>
      <div className="quick">
        <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Сумма, сом" aria-label="Сумма" />
        <button className="btn btn-primary" disabled={busy || !amount.trim()}>
          <Icon name="plus" size={18} /> Добавить
        </button>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (необязательно)" maxLength={200} />
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
