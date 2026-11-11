import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DAY_STATES,
  WEEKDAYS,
  addDays,
  api,
  dayMonth,
  dayShort,
  monthDays,
  monthKey,
  monthLabel,
  plural,
  rangeQuery,
  shiftMonth,
  todayKey,
  useApi,
  weekdayIdx,
} from '../../lib.js';
import { Avatar, Confirm, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, Segmented, useToast } from '../../components/ui.jsx';
import { AdminDayModal, ScheduleLegend, timeRange } from '../../components/schedule.jsx';

export function AdminSchedule() {
  const [month, setMonth] = useState(() => monthKey(todayKey()));
  const range = { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
  const { data, error, loading, reload } = useApi(`/admin/schedule?${rangeQuery(range)}`);
  const [open, setOpen] = useState(null);
  const [fill, setFill] = useState(false);
  const keys = monthDays(month);
  const today = data?.now.date ?? todayKey();

  const byUser = useMemo(() => {
    const m = new Map();
    for (const d of data?.days ?? []) {
      if (!m.has(d.userId)) m.set(d.userId, new Map());
      m.get(d.userId).set(d.date, d);
    }
    return m;
  }, [data]);
  const users = data?.users ?? [];
  const activeUsers = users.filter((u) => u.active && !u.deleted);
  const perDay = (k) => users.reduce((n, u) => n + (byUser.get(u.id)?.get(k)?.status === 'work' ? 1 : 0), 0);
  const days = data?.days ?? [];
  const absences = days.filter((d) => d.status === 'absent').length;

  const saved = () => {
    setOpen(null);
    setFill(false);
    reload();
  };

  return (
    <div className="page page-wide">
      <PageHead title="График" sub="Смены по графику засчитываются сами — открывать их не нужно">
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Предыдущий месяц">
            <Icon name="left" />
          </button>
          <span>{monthLabel(month)}</span>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Следующий месяц">
            <Icon name="right" />
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setFill(true)} disabled={!activeUsers.length}>
          <Icon name="wand" size={18} /> Заполнить
        </button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />

      {loading && !data ? (
        <Loading />
      ) : users.length === 0 ? (
        <Empty icon="users">
          Сначала добавьте сотрудников в разделе <Link to="/users">«Сотрудники»</Link>
        </Empty>
      ) : (
        <>
          <div className="chips-info">
            <span>
              <b>{days.filter((d) => d.status === 'work').length}</b> смен в графике
            </span>
            <span>
              <b>{absences}</b> {plural(absences, 'невыход', 'невыхода', 'невыходов')}
            </span>
            <span>
              <b>{days.filter((d) => d.state === 'needs_profit').length}</b> без прибыли
            </span>
          </div>
          <div className="card sgrid-card">
            <div className="sgrid-wrap">
              <table className="sgrid">
                <thead>
                  <tr>
                    <th className="sgrid-name">Сотрудник</th>
                    {keys.map((k) => (
                      <th key={k} className={`${weekdayIdx(k) > 4 ? 'is-weekend' : ''} ${k === today ? 'is-today' : ''}`}>
                        <small>{WEEKDAYS[weekdayIdx(k)]}</small>
                        <b>{Number(k.slice(8))}</b>
                      </th>
                    ))}
                    <th className="sgrid-total">Смен</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const row = byUser.get(u.id);
                    const editable = u.active && !u.deleted;
                    const count = row ? [...row.values()].filter((d) => d.status === 'work').length : 0;
                    return (
                      <tr key={u.id} className={editable ? '' : 'is-dim'}>
                        <th className="sgrid-name">
                          <span className="cell-user">
                            <Avatar name={u.name} size="sm" />
                            <span>
                              {u.name}
                              <small>
                                {u.deleted ? 'удалён' : !u.active ? 'заблокирован' : `${u.defaultStart}–${u.defaultEnd}`}
                              </small>
                            </span>
                          </span>
                        </th>
                        {keys.map((k) => {
                          const d = row?.get(k);
                          const cls = `${weekdayIdx(k) > 4 ? 'is-weekend' : ''} ${k === today ? 'is-today' : ''}`;
                          if (!d) {
                            return (
                              <td key={k} className={cls}>
                                {editable && (
                                  <button
                                    className="scell scell-empty"
                                    onClick={() => setOpen({ userId: u.id, date: k })}
                                    aria-label={`${u.name}, ${dayMonth(k)}: добавить смену`}
                                  >
                                    <Icon name="plus" size={14} />
                                  </button>
                                )}
                              </td>
                            );
                          }
                          const st = DAY_STATES[d.state];
                          return (
                            <td key={k} className={cls}>
                              <button
                                className={`scell tone-${st.tone}`}
                                onClick={() => setOpen(d)}
                                title={`${u.name}, ${dayMonth(k)} · ${timeRange(d)} · ${st.label}${d.absenceReason ? `: ${d.absenceReason}` : ''}`}
                                aria-label={`${u.name}, ${dayMonth(k)}: ${st.label}`}
                              >
                                {d.status === 'absent' ? <Icon name="x" size={13} stroke={3} /> : d.startTime.slice(0, 2)}
                              </button>
                            </td>
                          );
                        })}
                        <td className="sgrid-total">{count}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="sgrid-name">Выходят</th>
                    {keys.map((k) => (
                      <td key={k} className={k === today ? 'is-today' : ''}>
                        {perDay(k) || ''}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="sgrid-foot">
              <ScheduleLegend />
              <span className="small muted">В клетке — час начала смены. Нажмите на клетку, чтобы изменить день.</span>
            </div>
          </div>
        </>
      )}

      {open && <AdminDayModal day={open} operators={activeUsers} onClose={() => setOpen(null)} onSaved={saved} />}
      {fill && <FillModal users={activeUsers} month={month} today={today} onClose={() => setFill(false)} onDone={saved} />}
    </div>
  );
}

/* ---------- Заполнение графика по шаблону ---------- */

const PRESETS = [
  { label: 'Пн–Пт', days: [0, 1, 2, 3, 4] },
  { label: 'Пн–Сб', days: [0, 1, 2, 3, 4, 5] },
  { label: 'Каждый день', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Выходные', days: [5, 6] },
];

function FillModal({ users, month, today, onClose, onDone }) {
  const toast = useToast();
  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const [f, setF] = useState({
    userIds: new Set(users.map((u) => u.id)),
    pattern: 'cycle',
    weekdays: new Set([0, 1, 2, 3, 4]),
    cycleWork: 2,
    cycleOff: 2,
    from: monthStart > today ? monthStart : today <= monthEnd ? today : monthStart,
    to: monthEnd,
    times: 'own',
    startTime: users[0]?.defaultStart ?? '10:00',
    endTime: users[0]?.defaultEnd ?? '22:00',
    replace: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggle = (k, v) => {
    const s = new Set(f[k]);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    setF({ ...f, [k]: s });
  };

  const cycleLen = Number(f.cycleWork) + Number(f.cycleOff);
  const preview = Array.from({ length: 14 }, (_, i) => {
    const k = addDays(f.from, i);
    const work = f.pattern === 'cycle' ? cycleLen > 0 && i % cycleLen < Number(f.cycleWork) : f.weekdays.has(weekdayIdx(k));
    return { k, work };
  });
  const perPerson = (() => {
    if (!f.from || !f.to || f.to < f.from) return 0;
    let n = 0;
    for (let k = f.from, i = 0; k <= f.to && i < 400; k = addDays(k, 1), i++) {
      if (f.pattern === 'cycle' ? cycleLen > 0 && i % cycleLen < Number(f.cycleWork) : f.weekdays.has(weekdayIdx(k))) n++;
    }
    return n;
  })();

  const body = () => ({
    userIds: [...f.userIds],
    from: f.from,
    to: f.to,
    pattern: f.pattern,
    weekdays: [...f.weekdays],
    cycleWork: Number(f.cycleWork),
    cycleOff: Number(f.cycleOff),
    startTime: f.times === 'custom' ? f.startTime : '',
    endTime: f.times === 'custom' ? f.endTime : '',
    replace: f.replace,
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!f.userIds.size) return setError('Выберите сотрудников');
    setBusy(true);
    setError('');
    try {
      const r = await api('/admin/schedule/fill', { method: 'POST', body: body() });
      const parts = [`добавлено ${r.added}`];
      if (r.updated) parts.push(`изменено ${r.updated}`);
      if (r.removed) parts.push(`убрано ${r.removed}`);
      toast(`График заполнен: ${parts.join(', ')}`);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/schedule/clear', { method: 'POST', body: body() });
      toast(`Убрано смен: ${r.removed}`);
      onDone();
    } catch (err) {
      setConfirmClear(false);
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Заполнить график" sub="Смены добавятся сотрудникам по шаблону" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <Field label={`Сотрудники · ${f.userIds.size} из ${users.length}`}>
          <div className="chips">
            <button
              type="button"
              className={`chip ${f.userIds.size === users.length ? 'chip-on' : ''}`}
              onClick={() => setF({ ...f, userIds: new Set(f.userIds.size === users.length ? [] : users.map((u) => u.id)) })}
            >
              Все
            </button>
            {users.map((u) => (
              <button type="button" key={u.id} className={`chip ${f.userIds.has(u.id) ? 'chip-on' : ''}`} onClick={() => toggle('userIds', u.id)}>
                {u.name}
              </button>
            ))}
          </div>
        </Field>

        <Segmented
          value={f.pattern}
          onChange={(pattern) => setF({ ...f, pattern })}
          options={[
            { value: 'cycle', label: 'Сменный (2/2, 3/3…)' },
            { value: 'weekdays', label: 'По дням недели' },
          ]}
        />

        {f.pattern === 'cycle' ? (
          <div className="row2">
            <Field label="Рабочих дней подряд">
              <input type="number" min={1} max={14} value={f.cycleWork} onChange={set('cycleWork')} required />
            </Field>
            <Field label="Выходных дней">
              <input type="number" min={1} max={14} value={f.cycleOff} onChange={set('cycleOff')} required />
            </Field>
          </div>
        ) : (
          <Field label="Рабочие дни">
            <div className="chips">
              {WEEKDAYS.map((w, i) => (
                <button type="button" key={w} className={`chip chip-day ${f.weekdays.has(i) ? 'chip-on' : ''}`} onClick={() => toggle('weekdays', i)}>
                  {w}
                </button>
              ))}
              <span className="chips-sep" />
              {PRESETS.map((p) => (
                <button type="button" key={p.label} className="chip chip-ghost" onClick={() => setF({ ...f, weekdays: new Set(p.days) })}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="row2">
          <Field label={f.pattern === 'cycle' ? 'С даты (первый рабочий день)' : 'С даты'}>
            <input type="date" value={f.from} onChange={set('from')} required />
          </Field>
          <Field label="По дату">
            <input type="date" value={f.to} onChange={set('to')} required />
          </Field>
        </div>

        <div className="pattern-preview" aria-label="Первые две недели по шаблону">
          {preview.map((p) => (
            <span key={p.k} className={p.work ? 'is-work' : ''} title={dayMonth(p.k)}>
              <small>{WEEKDAYS[weekdayIdx(p.k)]}</small>
              {Number(p.k.slice(8))}
            </span>
          ))}
        </div>
        <p className="small muted">
          ≈ {perPerson} {plural(perPerson, 'смена', 'смены', 'смен')} на сотрудника с {dayShort(f.from || today)} по {dayShort(f.to || today)}.
          Уже заполненные дни не дублируются.
        </p>

        <Segmented
          size="sm"
          value={f.times}
          onChange={(times) => setF({ ...f, times })}
          options={[
            { value: 'own', label: 'Время из профиля сотрудника' },
            { value: 'custom', label: 'Задать время' },
          ]}
        />
        {f.times === 'custom' && (
          <div className="row2">
            <Field label="Начало">
              <input type="time" value={f.startTime} onChange={set('startTime')} required />
            </Field>
            <Field label="Конец" hint={f.endTime <= f.startTime ? 'на следующий день' : null}>
              <input type="time" value={f.endTime} onChange={set('endTime')} required />
            </Field>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={f.replace} onChange={set('replace')} />
          <span>
            Заменить существующий график
            <small>Будущие дни без прибыли и без отметок о невыходе будут приведены к шаблону</small>
          </span>
        </label>

        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmClear(true)} disabled={!f.userIds.size}>
            Очистить период
          </button>
          <button className="btn btn-primary" disabled={busy}>
            Заполнить
          </button>
        </div>
      </form>
      {confirmClear && (
        <Confirm
          title="Очистить график?"
          text={`Будут убраны смены выбранных сотрудников (${f.userIds.size}) с ${dayShort(f.from > today ? f.from : today)} по ${dayShort(f.to)}, по которым ещё не внесена прибыль. Прошедшие дни не затрагиваются.`}
          action="Очистить"
          busy={busy}
          onConfirm={clear}
          onClose={() => setConfirmClear(false)}
        />
      )}
    </Modal>
  );
}
