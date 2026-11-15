import { useApi, usePeriod, periodQuery, money, useStored, dayLabel } from '../lib.js';
import { ErrorBox, Insights, Kpi, Loading, PageHead, PeriodPicker, Section, Seg } from '../components/ui.jsx';
import { BarChart, CurveChart, Heatmap, HourBars, WeekdayBars } from '../components/charts.jsx';
import { WindowCard, buildInsights } from '../components/insights.jsx';
import { KpdRating } from '../components/rating.jsx';

export function StatsPage() {
  const [period, setPeriod] = usePeriod('stats');
  const [w, setW] = useStored('window-hours', 3);
  const [tab, setTab] = useStored('stats-tab', 'rating');
  const { data, error, loading, reload } = useApi(`/me/analytics?${periodQuery(period, { w })}`, { refreshMs: 60000 });
  const rating = useApi(`/me/rating?${periodQuery(period)}`, { refreshMs: 60000 });
  const me = rating.data?.rows.find((r) => r.userId === rating.data.meId);

  return (
    <div className="page">
      <PageHead title="Аналитика" subtitle="Когда и сколько приносит ваша работа">
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi label="Моя прибыль" icon="drop" tone="accent" value={money(data.totals.profit)} delta={data.compare.deltaProfit} />
            <Kpi label="Мой КПД" icon="trophy" value={me ? `${me.score} / 100` : '—'} sub={me ? `${me.place}-е место из ${rating.data.rows.length}` : 'ещё считается'} />
            <Kpi
              label="В среднем за день"
              icon="calendar"
              value={money(data.totals.perDay)}
              sub={data.totals.bestDay ? `рекорд ${money(data.totals.bestDay.profit)} · ${dayLabel(data.totals.bestDay.date, { day: 'numeric', month: 'short' })}` : '—'}
            />
            <Kpi label="Серия" icon="flame" value={me?.streak ? `🔥 ${me.streak} дн.` : '—'} sub="дней подряд с прибылью" />
          </div>

          <Insights items={buildInsights(data, { rating: rating.data, mine: true })} title="Что видно из цифр" />

          <Seg
            value={tab}
            onChange={setTab}
            options={[
              { value: 'rating', label: '🏆 Рейтинг' },
              { value: 'days', label: '📅 По дням' },
              { value: 'time', label: '⏰ По времени' },
            ]}
          />

          {tab === 'rating' && (
            <Section title="Рейтинг КПД команды">{rating.data ? <KpdRating data={rating.data} meId={rating.data.meId} /> : <Loading rows={1} />}</Section>
          )}

          {tab === 'days' && (
            <>
              <Section title={`Прибыль по ${data.series.mode === 'month' ? 'месяцам' : 'дням'}`}>
                <div className="card">
                  <BarChart series={data.series} />
                </div>
              </Section>
              <div className="two-col">
                <div className="card">
                  <div className="card-title">По дням недели (в среднем)</div>
                  <WeekdayBars byWeekday={data.byWeekday} />
                </div>
                {data.curve && (
                  <div className="card">
                    <div className="card-title">Сегодня против обычного дня</div>
                    <CurveChart curve={data.curve} />
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'time' && (
            <>
              <div className="two-col">
                <WindowCard window={data.window} windowHours={data.windowHours} onHours={setW} />
                <div className="card">
                  <div className="card-title">Прибыль по часам (в среднем за день)</div>
                  <HourBars byHour={data.byHour} window={data.window} />
                </div>
              </div>
              <Section title="Карта активности" aside={<span className="muted small">средняя прибыль по дню недели и часу</span>}>
                <div className="card">
                  <Heatmap heat={data.heat} />
                </div>
              </Section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
