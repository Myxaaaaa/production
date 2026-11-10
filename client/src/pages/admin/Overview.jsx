import { useEffect, useState } from 'react';
import { useApi, usePeriod, periodQuery, money, hours, duration, time } from '../../lib.js';
import { BarChart, ErrorBox, Icon, Leaderboard, Loading, PeriodPicker, Stat, Empty } from '../../components/ui.jsx';

function Since({ iso }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return <span>{duration(now - Date.parse(iso)).slice(0, 5)}</span>;
}

export function AdminOverview() {
  const [period, setPeriod] = usePeriod('admin-overview');
  const { data, error, loading, reload } = useApi(`/admin/stats?${periodQuery(period)}`);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Обзор</h1>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="stats">
            <Stat label="Прибыль" value={money(data.totals.profit)} accent="primary" />
            <Stat label="Фонд зарплаты" value={money(data.totals.total)} sub="с бонусами и штрафами" />
            <Stat label="Доходность" value={`${money(data.totals.profitPerHour)}/ч`} sub={`${money(data.totals.avgProfit)} за смену`} />
            <Stat label="Смен" value={data.totals.shifts} sub={hours(data.totals.hours)} />
            <Stat label="Бонусы" value={money(data.totals.bonuses)} accent="good" />
            <Stat label="Штрафы" value={money(data.totals.fines)} accent="bad" />
          </div>

          <h2 className="section-title">Сейчас на смене ({data.onShift.length})</h2>
          {data.onShift.length === 0 ? (
            <Empty>Никто не на смене</Empty>
          ) : (
            <ul className="list">
              {data.onShift.map((s) => (
                <li key={s.id} className="list-row">
                  <div>
                    <div className="list-title">
                      <span className="dot" /> {s.userName}
                    </div>
                    <div className="muted small">с {time(s.startAt)}</div>
                  </div>
                  <div className="list-right">
                    <Since iso={s.startAt} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="section-title">Прибыль по {data.series.mode === 'month' ? 'месяцам' : 'дням'}</h2>
          <div className="card">
            <BarChart series={data.series} />
          </div>

          <h2 className="section-title">Рейтинг и зарплаты</h2>
          <Leaderboard rows={data.leaderboard} withPay />

          <h2 className="section-title">Резервная копия</h2>
          <div className="card">
            <p className="muted">
              База автоматически копируется на Volume каждые сутки. Можно также скачать актуальную копию к себе.
            </p>
            <a className="btn btn-ghost" href="/api/admin/backup" download>
              <Icon name="download" size={18} /> Скачать копию базы
            </a>
          </div>
        </>
      ) : null}
    </div>
  );
}
