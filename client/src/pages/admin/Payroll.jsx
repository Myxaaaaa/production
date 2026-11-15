import { useState } from 'react';
import { api, useApi, usePeriod, periodQuery, periodRange, money, num, dayLabel, dateTime, todayKey, useStored, payModeText, signed } from '../../lib.js';
import { Avatar, Empty, ErrorBox, Field, Icon, Kpi, Loading, Modal, MoneyInput, PageHead, PeriodPicker, Seg, useToast } from '../../components/ui.jsx';
import { ScheduleCalendar } from '../../components/schedule.jsx';
import { AdjustmentsPanel } from './Adjustments.jsx';
import { PayScheme } from './Users.jsx';

const parseNum = (v) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));

export function AdminPayroll() {
  const [tab, setTab] = useStored('payroll-tab', 'sheet');
  const [period, setPeriod] = usePeriod('admin-payroll');
  const pending = useApi('/admin/advances/pending', { refreshMs: 30000 });
  const n = pending.data?.pending || 0;
  const periodTabs = ['sheet', 'payouts', 'adjustments'];
  return (
    <div className="page">
      <PageHead title="Зарплата" subtitle="Ведомость, график смен, авансы и выплаты">
        {periodTabs.includes(tab) && <PeriodPicker value={period} onChange={setPeriod} />}
      </PageHead>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sheet', label: 'Ведомость' },
          { value: 'schedule', label: 'График' },
          { value: 'advances', label: n ? `Авансы · ${n}` : 'Авансы' },
          { value: 'payouts', label: 'Выплаты' },
          { value: 'adjustments', label: 'Бонусы и штрафы' },
        ]}
      />
      {tab === 'sheet' && <Sheet period={period} />}
      {tab === 'schedule' && <SchedulePanel />}
      {tab === 'advances' && <AdvancesPanel onChange={pending.reload} />}
      {tab === 'payouts' && <Payouts period={period} />}
      {tab === 'adjustments' && <AdjustmentsPanel period={period} />}
    </div>
  );
}

function Sheet({ period }) {
  const q = periodQuery(period);
  const { data, error, loading, reload } = useApi(`/admin/payroll?${q}`, { refreshMs: 60000 });
  const [pay, setPay] = useState(null);
  const [open, setOpen] = useState(null);
  const [salary, setSalary] = useState(null);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.totals;
  return (
    <>
      <div className="kpis">
        <Kpi label="Начислено за период" icon="coins" tone="accent" value={money(t.accrued)} sub={`оклады ${money(t.base)} · % ${money(t.percentPay)}`} />
        <Kpi label="Прибыль за период" icon="drop" value={money(t.profit)} sub={t.profit > 0 ? `зарплаты — ${num((t.accrued / t.profit) * 100, 1)}% от прибыли` : '—'} />
        <Kpi label="Выплачено" icon="wallet" value={money(t.paid)} sub="за период, включая авансы" />
        <Kpi label="Долг по зарплате" icon="target" tone={t.balance > 0 ? 'warn' : undefined} value={money(t.balance)} sub="баланс к выплате, всё время" />
      </div>
      {data.rows.length === 0 ? (
        <Empty icon="users">Сотрудников пока нет</Empty>
      ) : (
        <div className="card flush">
          <table className="table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th className="num hide-sm">Дней</th>
                <th className="num hide-sm">Оклад</th>
                <th className="num hide-sm">% прибыли</th>
                <th className="num hide-sm">Бонусы / штрафы</th>
                <th className="num">Начислено</th>
                <th className="num">К выплате</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.userId} className={`clickable ${r.active ? '' : 'row-off'}`} onClick={() => setOpen(r)}>
                  <td>
                    <div className="user-cell">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        {r.name}
                        <div className="muted small">{payModeText(r)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num hide-sm">{num(r.workDays, 1)}</td>
                  <td className="num hide-sm">{r.payFixed || r.base ? money(r.base) : <span className="muted">выкл.</span>}</td>
                  <td className="num hide-sm">{r.payPercent || r.percentPay ? money(r.percentPay) : <span className="muted">выкл.</span>}</td>
                  <td className="num hide-sm">
                    {r.bonuses ? <span className="pos">+{num(r.bonuses, 2)}</span> : null} {r.fines ? <span className="neg">−{num(r.fines, 2)}</span> : null}
                    {r.corrections ? <div className="muted small">правки {signed(r.corrections)}</div> : null}
                    {!r.bonuses && !r.fines && !r.corrections && '—'}
                  </td>
                  <td className="num strong">{money(r.accrued)}</td>
                  <td className={`num strong ${r.balance > 0 ? 'warn-text' : ''}`}>
                    <button
                      className="balance-btn"
                      title="Изменить сумму к выплате"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSalary(r);
                      }}
                    >
                      {money(r.balance)} <Icon name="edit" size={13} />
                    </button>
                  </td>
                  <td className="num">
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPay(r);
                      }}
                      disabled={r.balance <= 0}
                    >
                      Выплатить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-end">
        <span className="muted small">Нажмите на сотрудника — откроется его график, схема оплаты и правка зарплаты.</span>
        <a className="btn btn-ghost" href={`/api/admin/payroll.csv?${q}`} download>
          <Icon name="file" size={17} /> Скачать ведомость (CSV для Excel)
        </a>
      </div>
      {pay && (
        <PayoutModal
          row={pay}
          onClose={() => setPay(null)}
          onSaved={() => {
            setPay(null);
            reload();
          }}
        />
      )}
      {salary && <SalaryModal row={salary} onClose={() => (setSalary(null), reload())} />}
      {open && <EmployeeModal row={open} period={period} onClose={() => (setOpen(null), reload())} />}
    </>
  );
}

function PayoutModal({ row, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: String(Math.max(0, Math.floor(row.balance))), date: todayKey(), note: '', notify: true });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('/admin/payouts', { method: 'POST', body: { ...f, userId: row.userId } });
      toast(`Выплата ${money(parseNum(f.amount))} записана`);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={`Выплата: ${row.name}`} subtitle={`К выплате сейчас ${money(row.balance)}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="row2">
          <Field label="Сумма, сом *">
            <MoneyInput value={f.amount} onChange={set('amount')} required autoFocus />
          </Field>
          <Field label="Дата *">
            <input type="date" value={f.date} onChange={set('date')} required />
          </Field>
        </div>
        <Field label="Комментарий">
          <input value={f.note} onChange={set('note')} maxLength={200} placeholder="Аванс, расчёт за месяц…" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.notify} onChange={set('notify')} /> Отправить сотруднику уведомление
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button className="btn btn-primary">Записать выплату</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Ручная правка суммы к выплате (только администратор) ---------- */

function SalaryModal({ row, onClose }) {
  return (
    <Modal title={`Зарплата: ${row.name}`} subtitle="Изменить актуальную сумму к выплате" onClose={onClose}>
      <SalaryEditor userId={row.userId} />
    </Modal>
  );
}

function SalaryEditor({ userId, onChanged }) {
  const toast = useToast();
  const { data, reload } = useApi(`/admin/users/${userId}/salary`);
  const [mode, setMode] = useState('target');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading rows={1} />;
  const v = parseNum(value);
  const ok = value.trim() !== '' && Number.isFinite(v);
  const after = ok ? (mode === 'target' ? v : data.balance + v) : null;
  const diff = ok ? Math.round((after - data.balance) * 100) / 100 : 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || !diff) return;
    setBusy(true);
    try {
      await api(`/admin/users/${userId}/salary`, { method: 'POST', body: mode === 'target' ? { target: value, reason, notify } : { delta: value, reason, notify } });
      toast(`Сумма к выплате теперь ${money(after)}`);
      setValue('');
      setReason('');
      reload();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c) => {
    if (!confirm(`Отменить правку ${signed(c.amount)} сом от ${dateTime(c.createdAt)}?`)) return;
    try {
      await api(`/admin/salary-corrections/${c.id}`, { method: 'DELETE' });
      reload();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="salary">
      <div className="salary-now">
        <span>Сейчас к выплате</span>
        <b>{money(data.balance)}</b>
        <span className="muted small">
          начислено {money(data.accrued)} − выплачено {money(data.paid)}
        </span>
      </div>
      <form className="form" onSubmit={submit}>
        <Seg
          size="sm"
          value={mode}
          onChange={(m) => (setMode(m), setValue(''))}
          options={[
            { value: 'target', label: 'Указать новую сумму' },
            { value: 'delta', label: 'Добавить / убрать' },
          ]}
        />
        <Field label={mode === 'target' ? 'Новая сумма к выплате, сом' : 'На сколько изменить, сом'} hint={mode === 'delta' ? 'Минус — чтобы убрать, например −500' : undefined}>
          <MoneyInput value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === 'target' ? String(Math.round(data.balance)) : '+1000 или −500'} />
        </Field>
        {ok && diff !== 0 && (
          <div className="salary-preview">
            {money(data.balance)} → <b>{money(after)}</b> <span className={diff > 0 ? 'pos' : 'neg'}>({signed(diff)})</span>
          </div>
        )}
        <Field label="Причина">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Например: перерасчёт за октябрь" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Сообщить сотруднику
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !ok || !diff}>
            Сохранить
          </button>
        </div>
      </form>
      {data.history.length > 0 && (
        <>
          <div className="card-title">История правок</div>
          <ul className="list card">
            {data.history.map((c) => (
              <li key={c.id}>
                <div>
                  <b className={c.amount > 0 ? 'pos' : 'neg'}>{signed(c.amount)} сом</b>
                  <div className="muted small">
                    {dateTime(c.createdAt)} · было {money(c.before)} → стало {money(c.after)}
                    {c.by && ` · ${c.by}`}
                    {c.reason && ` · ${c.reason}`}
                  </div>
                </div>
                <button className="icon-btn" onClick={() => remove(c)} aria-label="Отменить правку">
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ---------- Карточка сотрудника: график, оплата, зарплата ---------- */

function EmployeeModal({ row, period, onClose }) {
  const [tab, setTab] = useState('schedule');
  const { data, reload } = useApi(`/admin/payroll/${row.userId}?${periodQuery(period)}`);
  const r = periodRange(period);
  return (
    <Modal
      title={row.name}
      subtitle={`${dayLabel(r.from, { day: 'numeric', month: 'short' })} — ${dayLabel(r.to, { day: 'numeric', month: 'short' })} · к выплате ${money(data?.balance ?? row.balance)}`}
      onClose={onClose}
      wide
    >
      {data && (
        <div className="mini-kpis">
          <div>
            <span>Оклад</span>
            <b>{money(data.totals.base)}</b>
          </div>
          <div>
            <span>% от прибыли</span>
            <b>{money(data.totals.percentPay)}</b>
          </div>
          <div>
            <span>Бонусы − штрафы</span>
            <b>{money(data.totals.bonuses - data.totals.fines + (data.totals.corrections || 0))}</b>
          </div>
          <div>
            <span>Начислено</span>
            <b>{money(data.totals.accrued)}</b>
          </div>
        </div>
      )}
      <Seg
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'schedule', label: '📅 График' },
          { value: 'pay', label: '⚙️ Схема оплаты' },
          { value: 'salary', label: '✏️ Сумма к выплате' },
        ]}
      />
      <div className="modal-tab">
        {tab === 'schedule' && <ScheduleCalendar userId={row.userId} onChanged={reload} />}
        {tab === 'pay' && data && <PayEditor user={data.user} onSaved={reload} />}
        {tab === 'salary' && <SalaryEditor userId={row.userId} onChanged={reload} />}
      </div>
    </Modal>
  );
}

// Быстрое переключение схемы оплаты прямо из ведомости.
function PayEditor({ user, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ payFixed: user.payFixed, payPercent: user.payPercent, dailyRate: user.dailyRate, percent: user.percent, rateFrom: todayKey(), applyPercentToday: false });
  const [busy, setBusy] = useState(false);
  const changed = f.payFixed !== user.payFixed || f.payPercent !== user.payPercent || parseNum(f.dailyRate) !== user.dailyRate || parseNum(f.percent) !== user.percent;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}`, { method: 'PUT', body: f });
      toast('Схема оплаты сохранена');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={save}>
      <PayScheme f={f} setF={setF} />
      {changed && (
        <>
          <Field label="Изменение оклада действует с" hint="Прошлые дни останутся как были">
            <input type="date" value={f.rateFrom} onChange={(e) => setF({ ...f, rateFrom: e.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.applyPercentToday} onChange={(e) => setF({ ...f, applyPercentToday: e.target.checked })} />
            Применить новый % и к сегодняшним поступлениям
          </label>
        </>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !changed}>
          Сохранить
        </button>
      </div>
    </form>
  );
}

/* ---------- График всей команды ---------- */

function SchedulePanel() {
  const users = useApi('/admin/users');
  const operators = (users.data || []).filter((u) => u.role === 'operator' && u.active);
  const [userId, setUserId] = useStored('schedule-user', '');
  const current = operators.find((u) => String(u.id) === String(userId)) || operators[0];
  if (users.loading && !users.data) return <Loading />;
  if (!operators.length) return <Empty icon="users">Сотрудников пока нет</Empty>;
  return (
    <div className="card">
      <div className="emp-chips" role="tablist">
        {operators.map((u) => (
          <button key={u.id} type="button" className={`emp-chip ${current.id === u.id ? 'on' : ''}`} onClick={() => setUserId(u.id)}>
            <Avatar name={u.name} size="sm" /> {u.name}
          </button>
        ))}
      </div>
      <ScheduleCalendar userId={current.id} />
    </div>
  );
}

/* ---------- Авансы ---------- */

export const ADV_STATUS = {
  pending: { label: 'на рассмотрении', tone: 'warn', icon: '⏳' },
  approved: { label: 'одобрен', tone: 'accent', icon: '✅' },
  rejected: { label: 'отклонён', tone: 'bad', icon: '⛔' },
  cancelled: { label: 'отменён сотрудником', tone: 'muted', icon: '↩️' },
};

function AdvancesPanel({ onChange }) {
  const toast = useToast();
  const [status, setStatus] = useStored('advances-filter', 'pending');
  const { data, error, loading, reload } = useApi(`/admin/advances${status === 'all' ? '' : `?status=${status}`}`, { refreshMs: 20000 });
  const [deciding, setDeciding] = useState(null);
  const done = () => {
    setDeciding(null);
    reload();
    onChange?.();
    window.dispatchEvent(new Event('advances:changed'));
  };
  return (
    <>
      <Seg
        size="sm"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: `⏳ Ждут решения${data?.pending ? ` · ${data.pending}` : ''}` },
          { value: 'all', label: 'Все' },
          { value: 'approved', label: '✅ Одобренные' },
          { value: 'rejected', label: '⛔ Отклонённые' },
          { value: 'cancelled', label: '↩️ Отменённые' },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty icon="wallet" title={status === 'pending' ? 'Новых заявок нет' : 'Здесь пусто'}>
          Сотрудники запрашивают аванс в разделе «Авансы». Одобренный аванс сразу записывается как выплата и вычитается из зарплаты.
        </Empty>
      ) : (
        <div className="adv-list">
          {data.items.map((a) => (
            <div key={a.id} className={`card adv adv-${a.status}`}>
              <div className="adv-top">
                <div className="user-cell">
                  <Avatar name={a.userName} />
                  <div>
                    <b>{a.userName}</b>
                    <div className="muted small">{dateTime(a.createdAt)}</div>
                  </div>
                </div>
                <div className="adv-amount">
                  <b>{money(a.amount)}</b>
                  <span className={`tag tag-${ADV_STATUS[a.status].tone}`}>
                    {ADV_STATUS[a.status].icon} {ADV_STATUS[a.status].label}
                  </span>
                </div>
              </div>
              {a.reason && <div className="adv-reason">«{a.reason}»</div>}
              {a.status === 'pending' && (
                <>
                  <div className={`muted small ${a.balance < a.amount ? 'warn-text' : ''}`}>
                    Сейчас заработано к выплате: <b>{money(a.balance)}</b>
                    {a.balance < a.amount && ' — меньше, чем просит'}
                  </div>
                  <div className="adv-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => setDeciding({ a, kind: 'approve' })}>
                      ✅ Одобрить
                    </button>
                    <button className="btn btn-sm danger-text" onClick={() => setDeciding({ a, kind: 'reject' })}>
                      ⛔ Отклонить
                    </button>
                  </div>
                </>
              )}
              {a.log?.length > 0 && (
                <ol className="adv-log">
                  {a.log.map((l, i) => (
                    <li key={i} className={`log-${l.action}`}>
                      <span className="muted">{dateTime(l.at)}</span> · <b>{l.actor || '—'}</b> {l.text} {money(l.amount)}
                      {l.note && <span className="muted"> · «{l.note}»</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
      {deciding && <DecideModal {...deciding} onClose={() => setDeciding(null)} onDone={done} toast={toast} />}
    </>
  );
}

function DecideModal({ a, kind, onClose, onDone, toast }) {
  const [amount, setAmount] = useState(String(a.amount));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = kind === 'approve';
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/advances/${a.id}/${kind}`, { method: 'POST', body: approve ? { amount, note } : { note } });
      toast(approve ? `Аванс ${money(parseNum(amount))} одобрен и вычтен из зарплаты` : 'Заявка отклонена');
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={approve ? 'Одобрить аванс' : 'Отклонить аванс'} subtitle={`${a.userName} просит ${money(a.amount)}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {approve && (
          <Field label="Сумма аванса, сом" hint="Можно одобрить меньше, чем просили">
            <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label={approve ? 'Комментарий (необязательно)' : 'Причина отказа'}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoFocus={!approve} />
        </Field>
        {approve && <p className="muted small">Сумма запишется как выплата сегодняшним числом и уменьшит баланс к выплате сотрудника.</p>}
        <div className="form-actions">
          <button className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy}>
            {approve ? 'Одобрить и выплатить' : 'Отклонить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Payouts({ period }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/admin/payouts?${periodQuery(period)}`);
  const remove = async (p) => {
    if (!confirm(`Удалить выплату ${money(p.amount)} для ${p.userName}? Баланс сотрудника увеличится обратно.`)) return;
    try {
      await api(`/admin/payouts/${p.id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.length) return <Empty icon="wallet" title="Выплат за период нет">Выплату можно записать из ведомости кнопкой «Выплатить».</Empty>;
  return (
    <ul className="card list">
      {data.map((p) => (
        <li key={p.id}>
          <div className="user-cell">
            <Avatar name={p.userName} size="sm" />
            <div>
              <b>{p.userName}</b>
              <div className="muted small">
                {dayLabel(p.date)}
                {p.note && ` · ${p.note}`}
              </div>
            </div>
          </div>
          <div className="row-end">
            <b>{money(p.amount)}</b>
            <button className="icon-btn" onClick={() => remove(p)} aria-label="Удалить">
              <Icon name="trash" size={16} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
