import { useState } from 'react';
import {
  MONTHS_SHORT,
  WEEKDAYS,
  WEEKDAYS_LONG,
  compact,
  dayFull,
  dayMonth,
  dayShort,
  hours,
  monthLabel,
  money,
  num,
  periodQuery,
  plural,
  rangeLabel,
  som,
  todayKey,
  useApi,
  usePeriod,
} from '../../lib.js';
import { Avatar, Delta, Empty, ErrorBox, Icon, Kpi, Loading, PageHead, PeriodPicker, Section, Segmented } from '../../components/ui.jsx';
import { BarList, ChartTable, ColumnChart, Meter } from '../../components/charts.jsx';
import { AdminDayModal, timeRange } from '../../components/schedule.jsx';

const pointLabel = (key, mode) =>
  mode === 'month' ? `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]}` : String(Number(key.slice(8)));
const pointTitle = (key, mode) => (mode === 'month' ? monthLabel(key) : dayFull(key));

// Точки графика прибыли: значение + строки подсказки.
export function profitPoints(series, measure = 'profit') {
  return series.points.map((p) => ({
    key: p.key,
    label: pointLabel(p.key, series.mode),
    title: pointTitle(p.key, series.mode),
    value: p[measure],
    rows: [
      ['Прибыль', money(p.profit)],
      ...(p.pay !== undefined
        ? [
            ['Фонд зарплаты', money(p.pay)],
            ['Чистая прибыль', money(p.net)],
          ]
        : []),
      ['Смен', String(p.shifts)],
    ],
  }));
}

const MEASURES = [
  { value: 'profit', label: 'Прибыль' },
  { value: 'net', label: 'Чистая' },
];

export function AdminAnalytics() {
  const [period, setPeriod] = usePeriod('admin-analytics');
  const { data, error, loading, reload } = useApi(`/admin/analytics?${periodQuery(period)}`);
  const [measure, setMeasure] = useState('profit');
  const [asTable, setAsTable] = useState(false);
  const [open, setOpen] = useState(null);

  return (
    <div className="page">
      <PageHead title="Аналитика прибыли" sub="Прибыль, расходы на зарплату, сотрудники и дни недели">
        <PeriodPicker value={period} onChange={setPeriod} keys={['week', 'month', 'prevMonth', 'days30', 'days90', 'year', 'custom']} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <AnalyticsBody
          data={data}
          measure={measure}
          setMeasure={setMeasure}
          asTable={asTable}
          setAsTable={setAsTable}
          onOpen={setOpen}
        />
      ) : null}
      {open && (
        <AdminDayModal
          day={open}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function AnalyticsBody({ data, measure, setMeasure, asTable, setAsTable, onOpen }) {
  const t = data.totals;
  const p = data.previous;
  const hasPrev = p.shifts > 0;
  const hasProfit = data.series.points.some((x) => x.profit || x.pay);
  const bestDow = [...data.weekdays].filter((w) => w.shifts).sort((a, b) => b.avg - a.avg);
  const prevLabel = rangeLabel(p.range.from, p.range.to);

  return (
    <>
      <div className="hero-grid">
        <div className="hero-card">
          <div className="hero-label">Прибыль за период</div>
          <div className="hero-value">{som(t.profit)}</div>
          <div className="hero-meta">
            {hasPrev ? <Delta value={t.profit} prev={p.profit} suffix={`к ${prevLabel}`} /> : <span className="muted">Нет данных за прошлый период</span>}
          </div>
          <div className="breakdown">
            <div>
              <span>Фонд зарплаты</span>
              <b>{som(t.total)}</b>
            </div>
            <div>
              <span>Чистая прибыль</span>
              <b className={t.net < 0 ? 'neg' : ''}>{som(t.net)}</b>
            </div>
            <div>
              <span>Маржа</span>
              <b>{t.margin != null ? `${num(t.margin)}%` : '—'}</b>
            </div>
          </div>
        </div>

        {data.forecast ? (
          <div className="card card-pad forecast">
            <div className="card-title">
              <Icon name="trend" size={18} /> Прогноз на период
            </div>
            <div className="forecast-value">{som(data.forecast.total)}</div>
            <Meter value={data.forecast.actual} total={data.forecast.total} label="Факт от прогноза" />
            <div className="forecast-legend">
              <span>
                <i className="dot-accent" /> факт {som(data.forecast.actual)}
              </span>
              <span>
                <i className="dot-track" /> ожидается {som(data.forecast.expectedRest)}
              </span>
            </div>
            <p className="small muted">
              Осталось {data.forecast.remainingShifts} {plural(data.forecast.remainingShifts, 'смена', 'смены', 'смен')} по графику
              {data.forecast.missingShifts > 0 && ` и ${data.forecast.missingShifts} без внесённой прибыли`}. Ожидание — по средней прибыли
              каждого сотрудника за 60 дней.
            </p>
          </div>
        ) : (
          <div className="card card-pad forecast">
            <div className="card-title">
              <Icon name="sparkle" size={18} /> Итоги
            </div>
            <ul className="facts">
              <li>
                <span>Лучший день</span>
                <b>{data.best ? `${dayMonth(data.best.date)} · ${money(data.best.profit)}` : '—'}</b>
              </li>
              <li>
                <span>Слабый день</span>
                <b>{data.worst ? `${dayMonth(data.worst.date)} · ${money(data.worst.profit)}` : '—'}</b>
              </li>
              <li>
                <span>Лучший день недели</span>
                <b>{bestDow[0] ? WEEKDAYS_LONG[bestDow[0].dow] : '—'}</b>
              </li>
            </ul>
          </div>
        )}
      </div>

      <div className="kpis kpis-6">
        <Kpi label="Чистая прибыль" value={som(t.net)} delta={hasPrev && <Delta value={t.net} prev={p.net} suffix="" />} />
        <Kpi label="Фонд зарплаты" value={som(t.total)} delta={hasPrev && <Delta value={t.total} prev={p.total} invert suffix="" />} />
        <Kpi label="Средняя за смену" value={som(t.avgProfit)} delta={hasPrev && <Delta value={t.avgProfit} prev={p.avgProfit} suffix="" />} />
        <Kpi label="Доходность" value={`${som(t.profitPerHour)}/ч`} delta={hasPrev && <Delta value={t.profitPerHour} prev={p.profitPerHour} suffix="" />} />
        <Kpi label="Смен отработано" value={t.shifts} sub={hours(t.hours)} />
        <Kpi
          label="Посещаемость"
          value={t.attendance != null ? `${num(t.attendance)}%` : '—'}
          sub={`${t.absences} ${plural(t.absences, 'невыход', 'невыхода', 'невыходов')}`}
          tone={t.absences ? 'warn' : null}
        />
      </div>

      <Section
        title={`${measure === 'net' ? 'Чистая прибыль' : 'Прибыль'} по ${data.series.mode === 'month' ? 'месяцам' : 'дням'}`}
        aside={
          <div className="toolbar">
            <Segmented size="sm" value={measure} onChange={setMeasure} options={MEASURES} />
            <button className={`icon-btn ${asTable ? 'is-on' : ''}`} onClick={() => setAsTable(!asTable)} aria-label="Показать таблицей" title="Таблица">
              <Icon name="table" size={18} />
            </button>
          </div>
        }
      >
        <div className="card card-pad">
          {!hasProfit ? (
            <Empty icon="chart">За период прибыль ещё не внесена</Empty>
          ) : asTable ? (
            <ChartTable
              head={['Дата', 'Прибыль', 'Фонд ЗП', 'Чистая', 'Смен']}
              rows={data.series.points
                .filter((x) => x.shifts || x.pay)
                .map((x) => [
                  data.series.mode === 'month' ? monthLabel(x.key) : dayShort(x.key),
                  money(x.profit),
                  money(x.pay),
                  money(x.net),
                  x.shifts,
                ])}
            />
          ) : (
            <ColumnChart
              points={profitPoints(data.series, measure)}
              highlight={data.series.mode === 'day' ? todayKey() : todayKey().slice(0, 7)}
              label="Прибыль по дням"
            />
          )}
        </div>
      </Section>

      <div className="two-col">
        <Section title="По дням недели">
          <div className="card card-pad">
            {bestDow.length ? (
              <>
                <p className="insight">
                  <Icon name="sparkle" size={16} />
                  <span>
                    Самый прибыльный день — <b>{WEEKDAYS_LONG[bestDow[0].dow]}</b>: в среднем {money(bestDow[0].avg)} за смену
                    {bestDow.length > 1 && (
                      <>
                        , слабее всего — {WEEKDAYS_LONG[bestDow.at(-1).dow]} ({money(bestDow.at(-1).avg)})
                      </>
                    )}
                    .
                  </span>
                </p>
                <ColumnChart
                  height={160}
                  label="Средняя прибыль за смену по дням недели"
                  points={data.weekdays.map((w) => ({
                    key: String(w.dow),
                    label: WEEKDAYS[w.dow],
                    title: WEEKDAYS_LONG[w.dow][0].toUpperCase() + WEEKDAYS_LONG[w.dow].slice(1),
                    value: w.avg,
                    rows: [
                      ['Средняя за смену', money(w.avg)],
                      ['Всего прибыль', money(w.profit)],
                      ['Смен', String(w.shifts)],
                    ],
                  }))}
                />
              </>
            ) : (
              <Empty icon="chart">Недостаточно данных</Empty>
            )}
          </div>
        </Section>

        <Section title="Доля прибыли по сотрудникам">
          <div className="card card-pad">
            {data.employees.some((e) => e.profit > 0) ? (
              <BarList
                avatars
                rows={data.employees
                  .filter((e) => e.profit > 0)
                  .map((e) => ({
                    id: e.userId,
                    label: e.name,
                    value: e.profit,
                    display: `${compact(e.profit)} · ${num(e.share)}%`,
                  }))}
              />
            ) : (
              <Empty icon="users">Прибыль ещё не внесена</Empty>
            )}
          </div>
        </Section>
      </div>

      <Section title="Сотрудники">
        {data.employees.length === 0 ? (
          <Empty icon="users">В этом периоде нет смен</Empty>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table className="table table-sticky">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th className="num">Прибыль</th>
                    <th className="num">Смен</th>
                    <th className="num">За смену</th>
                    <th className="num">сом/ч</th>
                    <th className="num">Фонд ЗП</th>
                    <th className="num">Чистая</th>
                    <th className="num">Явка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.userId}>
                      <td>
                        <span className="cell-user">
                          <Avatar name={e.name} size="sm" />
                          {e.name}
                        </span>
                      </td>
                      <td className="num">
                        <b>{money(e.profit)}</b>
                      </td>
                      <td className="num">
                        {e.shifts}
                        {e.missingProfit > 0 && (
                          <span className="cell-warn" title="Смен без внесённой прибыли">
                            {' '}
                            ({e.missingProfit} без приб.)
                          </span>
                        )}
                      </td>
                      <td className="num">{money(e.avgProfit)}</td>
                      <td className="num">{money(e.profitPerHour)}</td>
                      <td className="num">{money(e.total)}</td>
                      <td className={`num ${e.net < 0 ? 'neg' : ''}`}>{money(e.net)}</td>
                      <td className="num">
                        {e.attendance != null ? `${num(e.attendance)}%` : '—'}
                        {e.absences > 0 && <span className="muted"> · {e.absences} н.</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <div className="two-col">
        <Section title={`Невыходы · ${data.absences.length}`}>
          {data.absences.length === 0 ? (
            <Empty icon="check">Все вышли по графику</Empty>
          ) : (
            <DayList days={data.absences} onOpen={onOpen} kind="absent" />
          )}
        </Section>
        <Section title={`Не внесена прибыль · ${data.missing.length}`}>
          {data.missing.length === 0 ? <Empty icon="check">Вся прибыль внесена</Empty> : <DayList days={data.missing} onOpen={onOpen} kind="missing" />}
        </Section>
      </div>
    </>
  );
}

function DayList({ days, onOpen, kind }) {
  const [all, setAll] = useState(false);
  const shown = all ? days : days.slice(0, 6);
  return (
    <ul className="list card">
      {shown.map((d) => (
        <li key={d.id}>
          <button className="list-row list-btn" onClick={() => onOpen(d)}>
            <Avatar name={d.userName} size="sm" />
            <div className="list-main">
              <div className="list-title">{d.userName}</div>
              <div className="list-sub">
                {dayMonth(d.date)} · {kind === 'absent' ? d.absenceReason : timeRange(d)}
              </div>
            </div>
            <span className="list-right small muted">
              {kind === 'absent' ? (d.absenceBySelf ? 'сам(а)' : d.absenceByName) : <span className="link">Внести</span>}
            </span>
          </button>
        </li>
      ))}
      {days.length > 6 && !all && (
        <li>
          <button className="list-more" onClick={() => setAll(true)}>
            Показать все ({days.length})
          </button>
        </li>
      )}
    </ul>
  );
}
