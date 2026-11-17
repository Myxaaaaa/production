import { Link } from 'react-router-dom';
import { useApi, periodQuery, money, minutes, dayLabel, todayKey, ago, time } from '../../lib.js';
import { Avatar, Empty, ErrorBox, Icon, Kpi, Loading, PageHead, Progress, Section } from '../../components/ui.jsx';
import { BarChart, CurveChart, HourBars } from '../../components/charts.jsx';
import { WindowCard } from '../../components/insights.jsx';
import { KpdRating } from '../../components/rating.jsx';

export function AdminOverview() {
  const live = useApi('/admin/live', { refreshMs: 15000 });
  const month = useApi(`/admin/analytics?${periodQuery({ key: 'month' })}`, { refreshMs: 60000 });
  const rating = useApi(`/admin/rating?${periodQuery({ key: 'month' })}`, { refreshMs: 120000 });
  const L = live.data;
  const A = month.data;

  return (
    <div className="page">
      <PageHead title="Обзор" subtitle={dayLabel(todayKey(), { weekday: 'long', day: 'numeric', month: 'long' })}>
        <Link to="/profit" className="btn btn-ghost">
          <Icon name="list" size={17} /> Все поступления
        </Link>
      </PageHead>
      <ErrorBox error={live.error || month.error} onRetry={() => (live.reload(), month.reload())} />
      {!L || !A ? (
        <Loading />
      ) : (
        <>
          <div className="kpis">
            <Kpi
              label="Прибыль сегодня"
              icon="drop"
              tone="accent"
              value={money(L.team.profit)}
              sub={
                L.team.goal > 0 ? (
                  <>
                    <Progress value={L.team.profit} max={L.team.goal} />
                    <span>цель {money(L.team.goal)}</span>
                  </>
                ) : (
                  'цель команды не задана'
                )
              }
            />
            <Kpi label="Начислено сегодня" icon="coins" value={money(L.team.earned)} sub="оклады за заполненные смены + %" />
            <Kpi label="Прибыль заполнена" icon="check" value={`${L.team.filled} из ${L.team.onShift}`} sub="сотрудников на смене сегодня" />
            <Kpi
              label="Прибыль за месяц"
              icon="calendar"
              value={money(A.totals.profit)}
              sub={A.forecast ? `прогноз до конца месяца ${money(A.forecast.profit)}` : `${money(A.totals.perDay)} в день`}
            />
          </div>

          <div className="two-col wide-left">
            <Section title="Сотрудники сегодня" aside={<Link to="/schedule" className="small">График →</Link>}>
              {L.rows.length === 0 ? (
                <Empty icon="users">
                  Сотрудников пока нет. <Link to="/users">Добавить</Link>
                </Empty>
              ) : (
                <ul className="card live">
                  {L.rows.map((r) => (
                    <li key={r.userId}>
                      <Avatar name={r.name} />
                      <div className="live-main">
                        <b>{r.name}</b>
                        <div className="muted small">
                          {!r.work ? 'выходной' : r.pending ? <span className="warn-text">⏳ прибыль за смену не заполнена</span> : '✅ прибыль заполнена'}
                          {r.lastEventAt && ` · последняя запись ${time(r.lastEventAt)}`}
                        </div>
                        {r.goal > 0 && <Progress value={r.profit} max={r.goal} />}
                      </div>
                      <div className="live-num">
                        <b>{money(r.profit)}</b>
                        <span className="muted small">заработал {money(r.earned)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <div className="stack">
              <WindowCard window={A.window} windowHours={A.windowHours} compact />
              <div className="card">
                <div className="card-title">По часам, месяц</div>
                <HourBars byHour={A.byHour} window={A.window} height={120} />
              </div>
            </div>
          </div>

          {rating.data && rating.data.rows.some((r) => r.profit > 0) && (
            <Section title="🏆 Топ по КПД за месяц" aside={<Link to="/rating" className="small">Весь рейтинг →</Link>}>
              <div className="card">
                <KpdRating data={rating.data} compact />
              </div>
            </Section>
          )}

          {A.curve && (
            <Section title="Сегодня против обычного дня">
              <div className="card">
                <CurveChart curve={A.curve} />
              </div>
            </Section>
          )}

          <Section title="Прибыль по дням" aside={<Link to="/analytics" className="small">Подробная аналитика →</Link>}>
            <div className="card">
              <BarChart series={A.series} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
