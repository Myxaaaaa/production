import { useApi, usePeriod, periodQuery, money, hours } from '../lib.js';
import { BarChart, ErrorBox, Leaderboard, Loading, PeriodPicker, Stat } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';

export function RatingPage() {
  const { user } = useAuth();
  const [period, setPeriod] = usePeriod('rating');
  const { data, error, loading, reload } = useApi(`/stats/overview?${periodQuery(period)}`);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Статистика</h1>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="stats">
            <Stat label="Моё место" value={data.myPlace ? `${data.myPlace} из ${data.leaderboard.length}` : '—'} accent="primary" />
            <Stat label="Общая прибыль" value={money(data.totals.profit)} />
            <Stat label="Доходность" value={`${money(data.totals.profitPerHour)}/ч`} sub={`в среднем ${money(data.totals.avgProfit)} за смену`} />
            <Stat label="Всего смен" value={data.totals.shifts} sub={hours(data.totals.hours)} />
          </div>
          <h2 className="section-title">Прибыль по {data.series.mode === 'month' ? 'месяцам' : 'дням'}</h2>
          <div className="card">
            <BarChart series={data.series} />
          </div>
          <h2 className="section-title">Рейтинг сотрудников</h2>
          <Leaderboard rows={data.leaderboard} meId={user.id} />
        </>
      ) : null}
    </div>
  );
}
