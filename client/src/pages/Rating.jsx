import { useApi, usePeriod, periodQuery, money, hours, todayKey } from '../lib.js';
import { Empty, ErrorBox, Kpi, Loading, PageHead, PeriodPicker, Section } from '../components/ui.jsx';
import { ColumnChart, Leaderboard } from '../components/charts.jsx';
import { profitPoints } from './admin/Analytics.jsx';
import { useAuth } from '../App.jsx';

export function RatingPage() {
  const { user } = useAuth();
  const [period, setPeriod] = usePeriod('rating');
  const { data, error, loading, reload } = useApi(`/stats/overview?${periodQuery(period)}`);

  return (
    <div className="page">
      <PageHead title="Рейтинг" sub="Общая статистика команды и ваше место">
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi
              label="Моё место"
              value={data.myPlace ? `${data.myPlace} из ${data.leaderboard.length}` : '—'}
              tone="accent"
              icon="award"
            />
            <Kpi label="Прибыль команды" value={money(data.totals.profit)} />
            <Kpi label="Доходность" value={`${money(data.totals.profitPerHour)}/ч`} sub={`${money(data.totals.avgProfit)} за смену`} />
            <Kpi label="Всего смен" value={data.totals.shifts} sub={hours(data.totals.hours)} />
          </div>
          <Section title={`Прибыль по ${data.series.mode === 'month' ? 'месяцам' : 'дням'}`}>
            <div className="card card-pad">
              {data.series.points.some((p) => p.profit) ? (
                <ColumnChart points={profitPoints(data.series)} highlight={todayKey()} label="Прибыль команды по дням" />
              ) : (
                <Empty icon="chart">За период прибыль ещё не внесена</Empty>
              )}
            </div>
          </Section>
          <Section title="Рейтинг сотрудников">
            <Leaderboard rows={data.leaderboard} meId={user.id} />
          </Section>
        </>
      ) : null}
    </div>
  );
}
