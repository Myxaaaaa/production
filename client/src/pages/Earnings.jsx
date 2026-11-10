import { useApi, usePeriod, periodQuery, money, hours, date, time, num } from '../lib.js';
import { ErrorBox, Empty, Loading, PeriodPicker, Stat } from '../components/ui.jsx';

export function EarningsPage() {
  const [period, setPeriod] = usePeriod('earnings');
  const { data, error, loading, reload } = useApi(`/me/summary?${periodQuery(period)}`);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Мой заработок</h1>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="stats">
            <Stat label="Итого к выплате" value={money(data.totals.total)} accent="primary" />
            <Stat label="Прибыль" value={money(data.totals.profit)} sub={`${money(data.totals.profitPerHour)} в час`} />
            <Stat label="Смен" value={data.totals.shifts} sub={hours(data.totals.hours)} />
            <Stat label="Ставка" value={money(data.totals.base)} sub="за смены и часы" />
            <Stat label="% от прибыли" value={money(data.totals.percentPay)} />
            <Stat label="Бонусы" value={money(data.totals.bonuses)} accent="good" />
            <Stat label="Штрафы" value={money(data.totals.fines)} accent="bad" />
          </div>

          <div className="card rates">
            <b>Мои текущие ставки:</b> {money(data.user.shiftRate)} за смену · {money(data.user.hourlyRate)} в час ·{' '}
            {num(data.user.percent, 2)}% от прибыли
          </div>

          {data.adjustments.length > 0 && (
            <>
              <h2 className="section-title">Бонусы и штрафы</h2>
              <ul className="list">
                {data.adjustments.map((a) => (
                  <li key={a.id} className="list-row">
                    <div>
                      <div className="list-title">{a.kind === 'bonus' ? 'Бонус' : 'Штраф'}</div>
                      <div className="muted small">
                        {date(a.date)}
                        {a.reason && ` · ${a.reason}`}
                      </div>
                    </div>
                    <div className={`list-right ${a.kind === 'bonus' ? 'pos' : 'neg'}`}>
                      {a.kind === 'bonus' ? '+' : '−'}
                      {money(a.amount)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="section-title">Смены</h2>
          {data.shifts.length === 0 ? (
            <Empty>За этот период смен нет</Empty>
          ) : (
            <ul className="list">
              {data.shifts.map((s) => (
                <li key={s.id} className="list-row">
                  <div>
                    <div className="list-title">{date(s.startAt)}</div>
                    <div className="muted small">
                      {time(s.startAt)}–{s.open ? 'идёт' : time(s.endAt)} {s.hours != null && `· ${hours(s.hours)}`}
                      {s.note && ` · ${s.note}`}
                    </div>
                  </div>
                  <div className="list-right">
                    <div>{s.open ? '—' : money(s.earnings)}</div>
                    {!s.open && <div className="muted small">прибыль {money(s.profit)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
