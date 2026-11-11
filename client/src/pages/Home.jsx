import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  dayFull,
  dayMonth,
  hours,
  keyToDate,
  money,
  monthKey,
  monthLabel,
  periodQuery,
  plural,
  rangeQuery,
  relativeDay,
  shiftMonth,
  todayKey,
  useApi,
  WEEKDAYS_LONG,
  weekdayIdx,
} from '../lib.js';
import { ErrorBox, Icon, Kpi, Loading, Section, StatusPill } from '../components/ui.jsx';
import { DaySheet, MonthCalendar, ScheduleLegend, timeRange } from '../components/schedule.jsx';
import { useUnread } from '../App.jsx';

export function PaydayBanner() {
  const { items } = useUnread();
  const today = todayKey();
  const next = items
    .filter((n) => n.kind === 'payday' && n.paydayDate && n.paydayDate >= today)
    .sort((a, b) => (a.paydayDate < b.paydayDate ? -1 : 1))[0];
  if (!next) return null;
  return (
    <Link to="/notifications" className="banner">
      <span className="banner-icon">
        <Icon name="wallet" />
      </span>
      <div>
        <b>День выдачи зарплаты — {relativeDay(next.paydayDate, today)}</b>
        <div>{dayMonth(next.paydayDate)}</div>
      </div>
      <Icon name="right" size={18} />
    </Link>
  );
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));


function useShiftClock(data) {
  const loadedAt = useRef(Date.now());
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [data]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!data) return null;
  const extra = (tick - loadedAt.current) / 60000;
  return (day) => {
    const base = data.now.date === day.date ? 0 : keyToDate(data.now.date) > keyToDate(day.date) ? 1440 : -1440;
    return base + toMin(data.now.time) + extra;
  };
}

// «сегодня», «завтра», «через 3 дня», а дальше — день недели.
function upcomingLabel(key, today) {
  const rel = relativeDay(key, today);
  return /^(сегодня|завтра|через)/.test(rel) ? rel : WEEKDAYS_LONG[weekdayIdx(key)];
}

function untilText(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

function TodayCard({ data, clock, onOpen }) {
  const day = data.current;
  if (!day) {
    const next = data.upcoming[0];
    return (
      <div className="today today-off">
        <div className="today-kicker">{dayFull(data.now.date)}</div>
        <div className="today-title">Сегодня выходной</div>
        <p className="today-text">
          {next ? (
            <>
              Следующая смена — <b>{relativeDay(next.date, data.now.date)}</b>, {timeRange(next)}
            </>
          ) : (
            'В графике пока нет ближайших смен. Администратор добавит их.'
          )}
        </p>
      </div>
    );
  }

  const start = toMin(day.startTime);
  let end = toMin(day.endTime);
  if (end <= start) end += 1440;
  const now = clock(day);
  const progress = Math.min(1, Math.max(0, (now - start) / (end - start)));

  const titles = {
    planned: 'Сегодня смена',
    active: 'Вы на смене',
    needs_profit: 'Смена завершена',
    done: 'Смена завершена',
    absent: 'Отмечен невыход',
  };

  return (
    <div className={`today today-${day.state}`}>
      <div className="today-top">
        <div className="today-kicker">{dayFull(day.date)}</div>
        <StatusPill state={day.state} />
      </div>
      <div className="today-title">{titles[day.state]}</div>
      <div className="today-time">
        <Icon name="clock" size={18} />
        {timeRange(day)} · {hours(day.hours)}
      </div>

      {day.state === 'planned' && <p className="today-text">Начало через {untilText(start - now)}. Отмечать приход не нужно — смена уже в графике.</p>}
      {day.state === 'active' && (
        <>
          <div className="progress" aria-label="Прошло смены">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="today-text">До конца смены {untilText(end - now)}</p>
        </>
      )}
      {day.state === 'needs_profit' && <p className="today-text">Внесите прибыль за смену — от неё считается ваш процент.</p>}
      {day.state === 'done' && (
        <div className="today-facts">
          <div>
            <span>Прибыль</span>
            <b>{money(day.profit)}</b>
          </div>
          <div>
            <span>Заработано</span>
            <b>{money(day.earnings)}</b>
          </div>
        </div>
      )}
      {day.state === 'absent' && (
        <p className="today-text">
          Причина: <b>{day.absenceReason}</b>
        </p>
      )}

      <div className="today-actions">
        {day.canEditProfit && (
          <button className="btn btn-primary btn-lg" onClick={() => onOpen(day, 'profit')}>
            <Icon name="coins" size={18} />
            {day.profit == null ? 'Внести прибыль' : 'Изменить прибыль'}
          </button>
        )}
        {day.canMarkAbsent && (
          <button className="btn btn-soft-bad btn-lg" onClick={() => onOpen(day, 'absent')}>
            <Icon name="slash" size={18} />
            {day.state === 'planned' ? 'Не смогу выйти' : 'Я не вышел(а)'}
          </button>
        )}
        {day.canUnmarkAbsent && (
          <button className="btn btn-ghost btn-lg" onClick={() => onOpen(day)}>
            Отменить отметку
          </button>
        )}
      </div>
    </div>
  );
}

export function HomePage() {
  const today = useApi('/me/today');
  const [month, setMonth] = useState(() => monthKey(todayKey()));
  const schedule = useApi(`/me/schedule?${rangeQuery({ from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` })}`);
  const summary = useApi(`/me/summary?${periodQuery({ key: 'month' })}`);
  const [open, setOpen] = useState(null);
  const clock = useShiftClock(today.data);

  const reloadAll = () => {
    setOpen(null);
    today.reload();
    schedule.reload();
    summary.reload();
  };

  if (today.loading && !today.data) return <Loading />;
  const t = summary.data?.totals;
  const data = today.data;

  return (
    <div className="page">
      <PaydayBanner />
      <ErrorBox error={today.error} onRetry={today.reload} />

      {data && (
        <div className="home-top">
          <TodayCard data={data} clock={clock} onOpen={(day, mode) => setOpen({ day, mode })} />

          {data.needsProfit.length > 0 && (
            <div className="card attention">
              <div className="attention-head">
                <span className="attention-icon">
                  <Icon name="alert" size={18} />
                </span>
                <div>
                  <b>
                    Не внесена прибыль за {data.needsProfit.length} {plural(data.needsProfit.length, 'смену', 'смены', 'смен')}
                  </b>
                  <div className="small muted">Без прибыли не начисляется процент</div>
                </div>
              </div>
              <ul className="mini-list">
                {data.needsProfit.map((d) => (
                  <li key={d.id}>
                    <button className="mini-row" onClick={() => setOpen({ day: d, mode: 'profit' })}>
                      <span>
                        <b>{dayMonth(d.date)}</b> · {timeRange(d)}
                      </span>
                      <span className="link">Внести</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!data.needsProfit.length && data.upcoming.length > 0 && (
            <div className="card upcoming">
              <div className="card-title">Ближайшие смены</div>
              <ul className="mini-list">
                {data.upcoming.map((d) => (
                  <li key={d.id}>
                    <button className="mini-row" onClick={() => setOpen({ day: d })}>
                      <span>
                        <b>{dayMonth(d.date)}</b>
                        <span className="muted"> · {upcomingLabel(d.date, data.now.date)}</span>
                      </span>
                      <span className="muted">{timeRange(d)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Section title="Этот месяц" aside={<Link to="/earnings" className="link">Подробнее</Link>}>
        {t ? (
          <div className="kpis">
            <Kpi label="Заработано" value={money(t.total)} tone="accent" icon="wallet" />
            <Kpi label="Отработано" value={`${t.shifts} ${plural(t.shifts, 'смена', 'смены', 'смен')}`} sub={hours(t.hours)} />
            <Kpi label="Прибыль" value={money(t.profit)} sub={t.avgProfit ? `${money(t.avgProfit)} за смену` : null} />
            <Kpi label="Впереди" value={`${t.planned} ${plural(t.planned, 'смена', 'смены', 'смен')}`} sub={t.absences ? `невыходов: ${t.absences}` : 'без невыходов'} />
          </div>
        ) : (
          <ErrorBox error={summary.error} onRetry={summary.reload} />
        )}
      </Section>

      <Section
        title="Мой график"
        aside={
          <div className="month-nav">
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Предыдущий месяц">
              <Icon name="left" />
            </button>
            <span>{monthLabel(month)}</span>
            <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Следующий месяц">
              <Icon name="right" />
            </button>
          </div>
        }
      >
        <div className="card card-pad">
          <ErrorBox error={schedule.error} onRetry={schedule.reload} />
          <MonthCalendar month={month} days={schedule.data?.days ?? []} today={data?.now.date ?? todayKey()} onPick={(day) => setOpen({ day })} />
          <ScheduleLegend />
        </div>
      </Section>

      {open && <DaySheet day={open.day} initialMode={open.mode} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </div>
  );
}
