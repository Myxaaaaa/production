import { useState } from 'react';
import { api, useApi, money, num, todayKey, ago, WEEKDAYS } from '../../lib.js';
import { Avatar, ErrorBox, Field, Icon, Loading, Modal, MoneyInput, PageHead, Toggle, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../App.jsx';

const daysText = (mask) => {
  if (mask === 127) return 'каждый день';
  if (mask === 31) return 'пн–пт';
  if (mask === 63) return 'пн–сб';
  return WEEKDAYS.filter((_, i) => (mask >> i) & 1).join(', ') || 'нет рабочих дней';
};

export function AdminUsers() {
  const { data, error, loading, reload } = useApi('/admin/users', { refreshMs: 30000 });
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <PageHead title="Сотрудники" subtitle="Оклад за смену, процент от прибыли, график и цели">
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={17} /> Добавить
        </button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="user-grid">
          {(data || []).map((u) => (
            <button key={u.id} className={`card user-card ${u.active ? '' : 'dimmed'}`} onClick={() => setEditing(u)}>
              <div className="user-cell">
                <Avatar name={u.name} />
                <div>
                  <b>{u.name}</b>
                  <div className="muted small">@{u.login}</div>
                </div>
                <div className="tags">
                  {u.role === 'admin' && <span className="tag tag-accent">админ</span>}
                  {!u.active && <span className="tag tag-bad">заблокирован</span>}
                </div>
              </div>
              {u.role === 'operator' && (
                <dl className="user-facts">
                  <div>
                    <dt>Оклад</dt>
                    <dd>{u.payFixed ? `${money(u.dailyRate)} за смену` : <span className="muted">выключен</span>}</dd>
                  </div>
                  <div>
                    <dt>% прибыли</dt>
                    <dd>{u.payPercent ? `${num(u.percent, 2)}%` : <span className="muted">выключен</span>}</dd>
                  </div>
                </dl>
              )}
            </button>
          ))}
        </div>
      )}
      {editing && (
        <UserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const toast = useToast();
  const { user: me } = useAuth();
  const isNew = !user.id;
  const [f, setF] = useState({
    name: user.name ?? '',
    login: user.login ?? '',
    password: '',
    role: user.role ?? 'operator',
    active: user.active ?? true,
    dailyRate: user.dailyRate ?? 0,
    percent: user.percent ?? 0,
    payFixed: user.payFixed ?? true,
    payPercent: user.payPercent ?? true,
    dailyGoal: user.dailyGoal ?? 0,
    workDays: user.workDays ?? 127,
    payStart: user.payStart ?? todayKey(),
    rateFrom: todayKey(),
    applyPercentToday: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isMe = user.id === me.id;
  const rateChanged = !isNew && (Number(String(f.dailyRate).replace(',', '.')) !== user.dailyRate || f.payFixed !== user.payFixed);
  const pctChanged = !isNew && (Number(String(f.percent).replace(',', '.')) !== user.percent || f.payPercent !== user.payPercent);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...f };
    if (!body.password) delete body.password;
    try {
      await api(isNew ? '/admin/users' : `/admin/users/${user.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? 'Сотрудник добавлен' : 'Изменения сохранены');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Удалить учётную запись «${user.name}»? Вход станет невозможен, оклад перестанет начисляться. История останется в статистике.`)) return;
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' });
      toast('Учётная запись удалена');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleDay = (i) => setF({ ...f, workDays: f.workDays ^ (1 << i) });

  return (
    <Modal title={isNew ? 'Новый сотрудник' : user.name} onClose={onClose}>
      <form className="form" onSubmit={submit} autoComplete="off">
        <Field label="Имя *">
          <input value={f.name} onChange={set('name')} required maxLength={80} />
        </Field>
        <div className="row2">
          <Field label="Логин *" hint="Латиница, цифры, . _ -">
            <input value={f.login} onChange={set('login')} required autoCapitalize="none" autoCorrect="off" />
          </Field>
          <Field label={isNew ? 'Пароль *' : 'Новый пароль'} hint={isNew ? 'Не короче 8 символов' : 'Пусто — не менять'}>
            <input value={f.password} onChange={set('password')} required={isNew} minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Роль">
          <select value={f.role} onChange={set('role')} disabled={isMe}>
            <option value="operator">Сотрудник</option>
            <option value="admin">Администратор</option>
          </select>
        </Field>
        {f.role === 'operator' && (
          <fieldset className="fieldset">
            <legend>Зарплата</legend>
            <PayScheme f={f} setF={setF} />
            <Field label="Цель по прибыли в день, сом" hint="0 — без цели. Когда цель выполнена, сотруднику придёт поздравление">
              <MoneyInput value={f.dailyGoal} onChange={set('dailyGoal')} />
            </Field>
            {rateChanged && (
              <Field label="Изменение оклада действует с" hint="Прошлые дни останутся по старой ставке">
                <input type="date" value={f.rateFrom} onChange={set('rateFrom')} />
              </Field>
            )}
            {pctChanged && (
              <label className="check">
                <input type="checkbox" checked={f.applyPercentToday} onChange={set('applyPercentToday')} />
                Применить новый % и к сегодняшним поступлениям
              </label>
            )}
            <Field label="Оклад начисляется с" hint="Дата начала работы">
              <input type="date" value={f.payStart} onChange={set('payStart')} />
            </Field>
            <p className="formula">
              <Icon name="info" size={15} />
              <span>
                Зарплата за день ={' '}
                {[
                  f.payFixed && <b key="f">оклад {money(Number(String(f.dailyRate).replace(',', '.')) || 0)}</b>,
                  f.payPercent && <b key="p">{num(Number(String(f.percent).replace(',', '.')) || 0, 2)}% от прибыли</b>,
                ]
                  .filter(Boolean)
                  .flatMap((x, i) => (i ? [' + ', x] : [x]))}
                {!f.payFixed && !f.payPercent && <b>0</b>} + бонусы − штрафы
              </span>
            </p>
          </fieldset>
        )}
        {!isNew && !isMe && (
          <label className="check">
            <input type="checkbox" checked={f.active} onChange={set('active')} />
            Учётная запись активна (может входить)
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && !isMe && (
            <button type="button" className="btn btn-ghost danger-text" onClick={remove}>
              <Icon name="trash" size={16} /> Удалить
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Схема оплаты: две галочки — фиксированный оклад и % с прибыли. Можно включить одно или оба.
export function PayScheme({ f, setF }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="pay-scheme">
      <div className={`pay-opt ${f.payFixed ? 'on' : ''}`}>
        <Toggle checked={f.payFixed} onChange={(v) => setF({ ...f, payFixed: v })} label="Фиксированный оклад" hint="Капает каждый рабочий день" />
        {f.payFixed && (
          <Field label="Оклад за смену, сом">
            <MoneyInput value={f.dailyRate} onChange={set('dailyRate')} />
          </Field>
        )}
      </div>
      <div className={`pay-opt ${f.payPercent ? 'on' : ''}`}>
        <Toggle checked={f.payPercent} onChange={(v) => setF({ ...f, payPercent: v })} label="% с прибыли" hint="С каждого поступления" />
        {f.payPercent && (
          <Field label="Процент, %">
            <MoneyInput value={f.percent} onChange={set('percent')} />
          </Field>
        )}
      </div>
      {!f.payFixed && !f.payPercent && <div className="alert alert-warn">Оба вида оплаты выключены — будут начисляться только бонусы.</div>}
    </div>
  );
}
