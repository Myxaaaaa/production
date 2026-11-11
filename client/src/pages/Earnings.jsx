import { useState } from 'react';
import { useApi, usePeriod, periodQuery, money, hours, num, dayShort, plural, WEEKDAYS, weekdayIdx } from '../lib.js';
import { Empty, ErrorBox, Icon, Kpi, Loading, PageHead, PeriodPicker, Section, StatusPill } from '../components/ui.jsx';
import { DaySheet, timeRange } from '../components/schedule.jsx';

export function EarningsPage() {
  const [period, setPeriod] = usePeriod('earnings');
  const { data, error, loading, reload } = useApi(`/me/summary?${periodQuery(period)}`);
  const [open, setOpen] = useState(null);
  const past = (data?.days ?? []).filter((d) => d.state !== 'planned');
  const upcoming = (data?.days.length ?? 0) - past.length;

  return (
    <div className="page">
      <PageHead title="Мой заработок" sub="Ставка, процент от прибыли, бонусы и штрафы">
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="hero-card">
            <div className="hero-label">Итого к выплате</div>
            <div className="hero-value">{money(data.totals.total)}</div>
            <div className="breakdown">
              <div>
                <span>Ставка</span>
                <b>{money(data.totals.base)}</b>
              </div>
              <div>
                <span>% от прибыли</span>
                <b>{money(data.totals.percentPay)}</b>
              </div>
              <div>
                <span>Бонусы</span>
                <b className="pos">+{money(data.totals.bonuses)}</b>
              </div>
              <div>
                <span>Штрафы</span>
                <b className="neg">−{money(data.totals.fines)}</b>
              </div>
            </div>
          </div>

          <div className="kpis">
            <Kpi label="Смен" value={data.totals.shifts} sub={hours(data.totals.hours)} />
            <Kpi label="Прибыль" value={money(data.totals.profit)} sub={`${money(data.totals.profitPerHour)} в час`} />
            <Kpi label="Средняя за смену" value={money(data.totals.avgProfit)} />
            <Kpi
              label="Невыходы"
              value={data.totals.absences}
              sub={data.totals.attendance != null ? `посещаемость ${num(data.totals.attendance)}%` : null}
            />
          </div>

          <div className="note-card">
            <Icon name="wallet" size={18} />
            <span>
              Ваши ставки: <b>{money(data.user.shiftRate)}</b> за смену · <b>{money(data.user.hourlyRate)}</b> в час ·{' '}
              <b>{num(data.user.percent, 2)}%</b> от прибыли
            </span>
          </div>

          {data.adjustments.length > 0 && (
            <Section title="Бонусы и штрафы">
              <ul className="list card">
                {data.adjustments.map((a) => (
                  <li key={a.id} className="list-row">
                    <span className={`list-icon ${a.kind === 'bonus' ? 'tone-good' : 'tone-bad'}`}>
                      <Icon name={a.kind === 'bonus' ? 'gift' : 'alert'} size={18} />
                    </span>
                    <div className="list-main">
                      <div className="list-title">{a.kind === 'bonus' ? 'Бонус' : 'Штраф'}</div>
                      <div className="list-sub">
                        {dayShort(a.date)}
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
            </Section>
          )}

          <Section
            title={`Смены · ${past.length}`}
            aside={upcoming > 0 && <span className="small muted">ещё {upcoming} {plural(upcoming, 'смена', 'смены', 'смен')} впереди</span>}
          >
            {past.length === 0 ? (
              <Empty icon="calendar">{upcoming ? 'Смены этого периода ещё впереди' : 'За этот период смен в графике нет'}</Empty>
            ) : (
              <ul className="list card">
                {past.map((d) => (
                  <li key={d.id}>
                    <button className="list-row list-btn" onClick={() => setOpen(d)}>
                      <span className="date-badge">
                        <b>{Number(d.date.slice(8))}</b>
                        <small>{WEEKDAYS[weekdayIdx(d.date)]}</small>
                      </span>
                      <div className="list-main">
                        <div className="list-title">
                          {timeRange(d)} <StatusPill state={d.state} />
                        </div>
                        <div className="list-sub">
                          {d.status === 'absent'
                            ? d.absenceReason
                            : d.profit != null
                              ? `прибыль ${money(d.profit)}${d.note ? ` · ${d.note}` : ''}`
                              : hours(d.hours)}
                        </div>
                      </div>
                      <div className="list-right">
                        {d.earnings != null ? <b>{money(d.earnings)}</b> : <span className="muted">—</span>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
      {open && (
        <DaySheet
          day={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
