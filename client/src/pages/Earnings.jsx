import { useApi, usePeriod, periodQuery, money, num, dayLabel, weekday, todayKey, signed, plural } from '../lib.js';
import { Empty, ErrorBox, Kpi, Loading, PageHead, PeriodPicker, Section } from '../components/ui.jsx';

export const OFF = {
  weekend: { label: 'выходной', tone: 'muted' },
  off: { label: 'выходной', tone: 'muted' },
  absent: { label: 'невыход', tone: 'bad' },
  sick: { label: 'больничный', tone: 'warn' },
  vacation: { label: 'отпуск', tone: 'sky' },
  before: { label: 'до начала работы', tone: 'muted' },
};

export function DayTable({ days }) {
  const today = todayKey();
  if (!days.length) return <Empty icon="calendar">Нет дней в периоде</Empty>;
  return (
    <div className="card flush">
      <table className="table">
        <thead>
          <tr>
            <th>День</th>
            <th className="num">Прибыль</th>
            <th className="num hide-sm">Оклад</th>
            <th className="num hide-sm">% и бонусы</th>
            <th className="num">Итого</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className={d.work ? '' : 'row-off'}>
              <td>
                <div className="day-cell">
                  <span className={`day-num ${d.date === today ? 'today' : ''}`}>{Number(d.date.slice(8))}</span>
                  <div>
                    <div>{weekday(d.date)}</div>
                    {d.off ? <span className={`tag tag-${OFF[d.off]?.tone}`}>{OFF[d.off]?.label}</span> : d.pending ? <span className="tag tag-warn">ждёт прибыль</span> : null}
                  </div>
                </div>
              </td>
              <td className="num">{d.profit ? money(d.profit) : '—'}</td>
              <td className="num hide-sm">{d.base ? money(d.base) : '—'}</td>
              <td className="num hide-sm">
                {d.percentPay || d.bonuses ? money(d.percentPay + d.bonuses) : '—'}
                {d.fines > 0 && <div className="neg small">−{money(d.fines)}</div>}
              </td>
              <td className="num strong">{d.total ? money(d.total) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EarningsPage() {
  const [period, setPeriod] = usePeriod('earnings');
  const { data, error, loading, reload } = useApi(`/me/payroll?${periodQuery(period)}`, { refreshMs: 60000 });
  const t = data?.totals;

  return (
    <div className="page">
      <PageHead title="Мой заработок" subtitle="Оклад за смену и процент начисляются, когда заполнена прибыль за день">
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="kpis">
            <Kpi label="Начислено за период" icon="coins" tone="accent" value={money(t.accrued)} sub={`${t.workDays} ${plural(t.workDays, 'смена', 'смены', 'смен')} · прибыль ${money(t.profit)}`} />
            <Kpi label="Оклад" icon="calendar" value={money(t.base)} sub={!data.user.payFixed ? 'оклад выключен' : t.pendingDays ? `ещё ${money(t.pendingBase)} — после заполнения прибыли` : `${money(data.user.dailyRate)} за смену`} />
            <Kpi label="% от прибыли" icon="drop" value={money(t.percentPay)} sub={data.user.payPercent ? `${num(data.user.percent, 2)}% с каждого поступления` : '% с прибыли выключен'} />
            <Kpi label="Бонусы / штрафы" icon="gift" value={<><span className="pos">+{num(t.bonuses, 2)}</span> <span className="neg">−{num(t.fines, 2)}</span></>} sub="сом" />
            <Kpi label="Выплачено" icon="wallet" value={money(t.paid)} sub="за период" />
            <Kpi label="К выплате сейчас" icon="target" tone="accent" value={money(data.balance)} sub="баланс за всё время" />
          </div>

          <div className="two-col wide-left">
            <Section title="По дням">
              <DayTable days={t.days} />
            </Section>
            <div className="stack">
              {data.corrections?.length > 0 && (
                <Section title="Правки администратора">
                  <ul className="card list">
                    {data.corrections.map((c) => (
                      <li key={c.id}>
                        <div>
                          <b>Перерасчёт</b>
                          <div className="muted small">
                            {new Date(c.date).toLocaleDateString('ru-RU')}
                            {c.reason && ` · ${c.reason}`}
                          </div>
                        </div>
                        <b className={c.amount > 0 ? 'pos' : 'neg'}>{signed(c.amount)} сом</b>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <Section title="Выплаты">
                {data.payouts.length === 0 ? (
                  <Empty icon="wallet">За период выплат не было</Empty>
                ) : (
                  <ul className="card list">
                    {data.payouts.map((p) => (
                      <li key={p.id}>
                        <div>
                          <b>{dayLabel(p.date)}</b>
                          {p.note && <div className="muted small">{p.note}</div>}
                        </div>
                        <b>{money(p.amount)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Бонусы и штрафы">
                {data.adjustments.length === 0 ? (
                  <Empty icon="gift">За период ничего не было</Empty>
                ) : (
                  <ul className="card list">
                    {data.adjustments.map((a) => (
                      <li key={a.id}>
                        <div>
                          <b>{a.kind === 'bonus' ? 'Бонус' : 'Штраф'}</b>
                          <div className="muted small">
                            {new Date(a.date).toLocaleDateString('ru-RU')}
                            {a.reason && ` · ${a.reason}`}
                          </div>
                        </div>
                        <b className={a.kind === 'bonus' ? 'pos' : 'neg'}>
                          {a.kind === 'bonus' ? '+' : '−'}
                          {money(a.amount)}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
