import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dayFull, dayMonth, money, num, periodQuery, plural, relativeDay, som, useApi } from '../../lib.js';
import { Avatar, Empty, ErrorBox, Icon, Kpi, Loading, PageHead, Section, StatusPill } from '../../components/ui.jsx';
import { Meter } from '../../components/charts.jsx';
import { AdminDayModal, timeRange } from '../../components/schedule.jsx';

export function AdminOverview() {
  const today = useApi('/admin/today');
  const month = useApi(`/admin/analytics?${periodQuery({ key: 'month' })}`);
  const users = useApi('/admin/users');
  const [open, setOpen] = useState(null);
  const operators = (users.data || []).filter((u) => u.role === 'operator' && u.active);

  const saved = () => {
    setOpen(null);
    today.reload();
    month.reload();
  };

  if (today.loading && !today.data) return <Loading />;
  const d = today.data;
  const list = d?.today ?? [];
  const working = list.filter((x) => x.status === 'work');
  const active = list.filter((x) => x.state === 'active');
  const absent = list.filter((x) => x.status === 'absent');
  const profitToday = list.reduce((s, x) => s + (x.profit ?? 0), 0);
  const m = month.data;

  return (
    <div className="page">
      <PageHead title="Обзор" sub={d ? `Сегодня ${dayFull(d.now.date)}` : null}>
        <Link className="btn btn-ghost" to="/schedule">
          <Icon name="calendar" size={18} /> График
        </Link>
        <button className="btn btn-primary" onClick={() => setOpen({})}>
          <Icon name="plus" size={18} /> Смена
        </button>
      </PageHead>
      <ErrorBox error={today.error} onRetry={today.reload} />

      {d && (
        <>
          <div className="kpis">
            <Kpi label="Выходят сегодня" value={working.length} icon="calendar" />
            <Kpi label="Сейчас на смене" value={active.length} icon="clock" tone={active.length ? 'live' : null} />
            <Kpi label="Не вышли" value={absent.length} icon="slash" tone={absent.length ? 'bad' : null} />
            <Kpi label="Прибыль сегодня" value={money(profitToday)} icon="coins" />
          </div>

          <div className="two-col two-col-wide">
            <Section title="Сегодня по графику">
              {list.length === 0 ? (
                <Empty icon="calendar">
                  На сегодня смен нет. <Link to="/schedule">Заполнить график</Link>
                </Empty>
              ) : (
                <ul className="list card">
                  {list.map((x) => (
                    <li key={x.id}>
                      <button className="list-row list-btn" onClick={() => setOpen(x)}>
                        <Avatar name={x.userName} />
                        <div className="list-main">
                          <div className="list-title">{x.userName}</div>
                          <div className="list-sub">
                            {x.date !== d.now.date && 'с вчера · '}
                            {timeRange(x)}
                            {x.status === 'absent' && ` · ${x.absenceReason}`}
                          </div>
                        </div>
                        <div className="list-right">
                          <StatusPill state={x.state} />
                          {x.profit != null && <div className="small">{money(x.profit)}</div>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div>
              {m && (
                <Section title="Этот месяц" aside={<Link to="/analytics" className="link">Аналитика</Link>}>
                  <div className="card card-pad month-card">
                    <div className="month-card-row">
                      <div>
                        <div className="kpi-label">Прибыль</div>
                        <div className="month-card-value">{som(m.totals.profit)}</div>
                      </div>
                      <div>
                        <div className="kpi-label">Чистая</div>
                        <div className="month-card-value">{som(m.totals.net)}</div>
                      </div>
                    </div>
                    {m.forecast && (
                      <>
                        <Meter value={m.forecast.actual} total={m.forecast.total} label="Факт от прогноза" />
                        <div className="small muted">
                          Прогноз на месяц <b className="ink">{som(m.forecast.total)}</b> · осталось {m.forecast.remainingShifts}{' '}
                          {plural(m.forecast.remainingShifts, 'смена', 'смены', 'смен')}
                        </div>
                      </>
                    )}
                    <ul className="facts">
                      <li>
                        <span>Фонд зарплаты</span>
                        <b>{som(m.totals.total)}</b>
                      </li>
                      <li>
                        <span>Смен отработано</span>
                        <b>{m.totals.shifts}</b>
                      </li>
                      <li>
                        <span>Посещаемость</span>
                        <b>{m.totals.attendance != null ? `${num(m.totals.attendance)}%` : '—'}</b>
                      </li>
                    </ul>
                  </div>
                </Section>
              )}
            </div>
          </div>

          <div className="two-col">
            <Section title={`Не внесена прибыль · ${d.missing.length}`}>
              {d.missing.length === 0 ? (
                <Empty icon="check">Вся прибыль за прошедшие смены внесена</Empty>
              ) : (
                <ul className="list card">
                  {d.missing.slice(0, 8).map((x) => (
                    <li key={x.id}>
                      <button className="list-row list-btn" onClick={() => setOpen(x)}>
                        <span className="list-icon tone-warn">
                          <Icon name="alert" size={18} />
                        </span>
                        <div className="list-main">
                          <div className="list-title">{x.userName}</div>
                          <div className="list-sub">
                            {dayMonth(x.date)} · {timeRange(x)}
                          </div>
                        </div>
                        <span className="link small">Внести</span>
                      </button>
                    </li>
                  ))}
                  {d.missing.length > 8 && <li className="list-foot">и ещё {d.missing.length - 8} — см. «Аналитика»</li>}
                </ul>
              )}
            </Section>

            <Section title="Невыходы за неделю и впереди">
              {d.absences.length === 0 ? (
                <Empty icon="check">Отметок о невыходе нет</Empty>
              ) : (
                <ul className="list card">
                  {d.absences.map((x) => (
                    <li key={x.id}>
                      <button className="list-row list-btn" onClick={() => setOpen(x)}>
                        <span className="list-icon tone-bad">
                          <Icon name="slash" size={18} />
                        </span>
                        <div className="list-main">
                          <div className="list-title">
                            {x.userName} · {relativeDay(x.date, d.now.date)}
                          </div>
                          <div className="list-sub">{x.absenceReason}</div>
                        </div>
                        <span className="small muted">{x.absenceBySelf ? 'отметил(а) сам(а)' : x.absenceByName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="Резервная копия">
            <div className="card card-pad backup">
              <span className="list-icon">
                <Icon name="download" size={18} />
              </span>
              <p className="muted">База автоматически копируется на Volume каждые сутки. Можно скачать актуальную копию к себе.</p>
              <a className="btn btn-ghost" href="/api/admin/backup" download>
                Скачать копию базы
              </a>
            </div>
          </Section>
        </>
      )}

      {open && <AdminDayModal day={open} operators={operators} onClose={() => setOpen(null)} onSaved={saved} />}
    </div>
  );
}
