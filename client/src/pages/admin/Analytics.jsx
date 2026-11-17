import { useApi, usePeriod, periodQuery, money, useStored, dayLabel, num, hh } from '../../lib.js';
import { ErrorBox, Kpi, Loading, PageHead, PeriodPicker, Section, Empty, Avatar, Seg, Insights } from '../../components/ui.jsx';
import { BarChart, CurveChart, Heatmap, HourBars, MoneyChart, PayBreakdown, WeekdayBars } from '../../components/charts.jsx';
import { WindowCard, buildInsights } from '../../components/insights.jsx';
import { KpdRating } from '../../components/rating.jsx';

const TABS = [
  { value: 'money', label: 'Деньги' },
  { value: 'days', label: 'По дням' },
  { value: 'time', label: 'По времени' },
  { value: 'team', label: 'Сотрудники' },
];

export function AdminAnalytics() {
  const [period, setPeriod] = usePeriod('admin-analytics');
  const [userId, setUserId] = useStored('admin-analytics-user', '');
  const [w, setW] = useStored('window-hours', 3);
  const [tab, setTab] = useStored('admin-analytics-tab', 'money');
  const users = useApi('/admin/users');
  const { data, error, loading, reload } = useApi(`/admin/analytics?${periodQuery(period, { userId, w })}`, { refreshMs: 60000 });
  const rating = useApi(`/admin/rating?${periodQuery(period)}`, { refreshMs: 60000 });
  const operators = (users.data || []).filter((u) => u.role === 'operator');
  const tabs = userId ? TABS.filter((t) => t.value !== 'team') : TABS;
  const cur = tabs.some((t) => t.value === tab) ? tab : 'money';
  const m = data?.money;

  return (
    <div className="page">
      <PageHead title="Аналитика" subtitle="Сколько заработали, сколько ушло на зарплаты и что можно улучшить">
        <select className="select-pill" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
          <option value="">Вся команда</option>
          {operators.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis kpis-6">
            <Kpi label="Прибыль" icon="drop" tone="accent" value={money(data.totals.profit)} delta={data.compare.deltaProfit} hint={`Прошлый отрезок: ${money(data.compare.profit)}`} />
            <Kpi label="Зарплаты" icon="wallet" value={money(m.payroll)} delta={m.delta.payroll} invert sub={m.payShare != null ? `${num(m.payShare, 0)}% от прибыли` : null} />
            <Kpi label="Остаётся чистыми" icon="coins" tone={m.net < 0 ? 'warn' : undefined} value={money(m.net)} delta={m.delta.net} sub={m.margin != null ? `маржа ${num(m.margin, 0)}%` : null} />
            <Kpi label="В среднем за день" icon="calendar" value={money(data.totals.perDay)} sub={`${data.totals.days} дн. в периоде`} />
            <Kpi label="Средний чек" icon="zap" value={money(data.totals.avgEvent)} sub={`${data.totals.events} поступлений`} />
            <Kpi
              label={data.forecast ? 'Прогноз на период' : 'Лучший день'}
              icon={data.forecast ? 'chart' : 'award'}
              value={data.forecast ? money(data.forecast.profit) : data.totals.bestDay ? money(data.totals.bestDay.profit) : '—'}
              sub={data.forecast ? 'если темп сохранится' : data.totals.bestDay ? dayLabel(data.totals.bestDay.date) : ''}
            />
          </div>

          <Insights items={buildInsights(data, { m, rating: userId ? null : rating.data })} />

          <Seg value={cur} onChange={setTab} options={tabs} />

          {cur === 'money' && (
            <>
              <Section title="Прибыль и зарплаты" aside={<span className="muted small">наведите на столбик — увидите остаток</span>}>
                <div className="card">
                  <MoneyChart series={m.series} />
                </div>
              </Section>
              <div className="two-col">
                <div className="card">
                  <div className="card-title">Из чего состоят зарплаты</div>
                  <PayBreakdown m={m} />
                </div>
                <div className="card">
                  <div className="card-title">Было → стало</div>
                  <Compare
                    rows={[
                      ['Прибыль', m.prev.profit, m.profit],
                      ['Зарплаты', m.prev.payroll, m.payroll, true],
                      ['Остаётся', m.prev.net, m.net],
                    ]}
                    from={m.prev.from}
                    to={m.prev.to}
                  />
                </div>
              </div>
            </>
          )}

          {cur === 'days' && (
            <>
              <Section title={`Прибыль по ${data.series.mode === 'month' ? 'месяцам' : 'дням'}`}>
                <div className="card">
                  <BarChart series={data.series} />
                </div>
              </Section>
              <div className="two-col">
                <div className="card">
                  <div className="card-title">Средняя прибыль по дням недели</div>
                  <WeekdayBars byWeekday={data.byWeekday} />
                </div>
                {data.curve ? (
                  <div className="card">
                    <div className="card-title">Сегодня против обычного дня</div>
                    <CurveChart curve={data.curve} />
                  </div>
                ) : (
                  <div className="card">
                    <div className="card-title">Рекорды</div>
                    <ul className="facts">
                      {data.totals.bestDay && (
                        <li>
                          🏆 Лучший день: <b>{dayLabel(data.totals.bestDay.date)}</b> — {money(data.totals.bestDay.profit)}
                        </li>
                      )}
                      {data.totals.worstDay && (
                        <li>
                          🐌 Самый слабый: <b>{dayLabel(data.totals.worstDay.date)}</b> — {money(data.totals.worstDay.profit)}
                        </li>
                      )}
                      <li>
                        ✅ Дней с прибылью: <b>{data.totals.goodDays}</b> из {data.totals.days}
                      </li>
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {cur === 'time' && (
            <>
              <div className="two-col">
                <WindowCard window={data.window} windowHours={data.windowHours} onHours={setW} />
                <div className="card">
                  <div className="card-title">Средняя прибыль по часам суток</div>
                  <HourBars byHour={data.byHour} window={data.window} />
                </div>
              </div>
              <Section title="Карта: день недели × час" aside={<span className="muted small">где темнее — там больше прибыли</span>}>
                <div className="card">
                  <Heatmap heat={data.heat} />
                </div>
              </Section>
            </>
          )}

          {cur === 'team' && (
            <>
              <Section title="Рейтинг КПД">{rating.data ? <KpdRating data={rating.data} /> : <Loading rows={1} />}</Section>
              <Section title="Вклад каждого">
                {data.leaderboard.length === 0 ? (
                  <Empty icon="users">Нет поступлений за период</Empty>
                ) : (
                  <div className="card flush">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Сотрудник</th>
                          <th className="num">Прибыль</th>
                          <th className="num">Доля</th>
                          <th className="num hide-sm">Акт. часов</th>
                          <th className="num">сом/ч</th>
                          <th className="hide-sm">Лучшее время</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.leaderboard.map((r) => (
                          <tr key={r.userId} className="clickable" onClick={() => setUserId(String(r.userId))}>
                            <td>
                              <div className="user-cell">
                                <Avatar name={r.name} size="sm" />
                                {r.name}
                              </div>
                            </td>
                            <td className="num strong">{money(r.profit)}</td>
                            <td className="num">
                              <div className="share">
                                <i style={{ width: `${r.share}%` }} />
                                <span>{num(r.share, 0)}%</span>
                              </div>
                            </td>
                            <td className="num hide-sm">{r.activeHours}</td>
                            <td className="num">{money(r.perHour)}</td>
                            <td className="hide-sm">{r.window ? `${hh(r.window.start)}–${hh(r.window.end)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="muted small">Нажмите на сотрудника, чтобы открыть его личную аналитику.</p>
              </Section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

export function Compare({ rows, from, to }) {
  return (
    <div className="compare">
      <div className="muted small">
        {dayLabel(from, { day: 'numeric', month: 'short' })} – {dayLabel(to, { day: 'numeric', month: 'short' })} → сейчас
      </div>
      {rows.map(([label, a, b, invert]) => {
        const up = b > a;
        const good = a === b ? null : invert ? !up : up;
        return (
          <div key={label} className="compare-row">
            <span>{label}</span>
            <span className="muted">{money(a)}</span>
            <span>→</span>
            <b className={good === null ? '' : good ? 'pos' : 'neg'}>{money(b)}</b>
          </div>
        );
      })}
    </div>
  );
}
