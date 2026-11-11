import { useState } from 'react';
import { api, useApi, money, num, relativeDay } from '../../lib.js';
import { Avatar, Confirm, ErrorBox, Field, Icon, Loading, Modal, MoneyInput, PageHead, StatusPill, useToast } from '../../components/ui.jsx';
import { timeRange } from '../../components/schedule.jsx';
import { useAuth } from '../../App.jsx';

export function AdminUsers() {
  const { data, error, loading, reload } = useApi('/admin/users');
  const [editing, setEditing] = useState(null);
  const operators = (data || []).filter((u) => u.role === 'operator');
  const admins = (data || []).filter((u) => u.role === 'admin');

  return (
    <div className="page">
      <PageHead title="Сотрудники" sub={data ? `${operators.length} сотрудников · ${admins.length} администр.` : null}>
        <button className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" size={18} /> Добавить
        </button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="people">
          {[...operators, ...admins].map((u) => (
            <button key={u.id} className={`person card ${u.active ? '' : 'is-dim'}`} onClick={() => setEditing(u)}>
              <div className="person-top">
                <Avatar name={u.name} size="lg" />
                <div className="person-name">
                  <b>{u.name}</b>
                  <span>{u.login}</span>
                </div>
                {u.role === 'admin' && <span className="tag">админ</span>}
                {!u.active && <span className="tag tag-off">заблокирован</span>}
              </div>
              {u.role === 'operator' && (
                <>
                  <div className="person-row">
                    <span>Сегодня</span>
                    {u.today ? (
                      <span className="person-today">
                        {timeRange(u.today)} <StatusPill state={u.today.state} />
                      </span>
                    ) : (
                      <span className="muted">выходной{u.nextDate ? ` · след. ${relativeDay(u.nextDate)}` : ''}</span>
                    )}
                  </div>
                  <div className="person-row">
                    <span>Смена по умолчанию</span>
                    <b>
                      {u.defaultStart}–{u.defaultEnd}
                    </b>
                  </div>
                  <div className="person-row">
                    <span>Ставки</span>
                    <b>
                      {money(u.shiftRate)} · {money(u.hourlyRate)}/ч · {num(u.percent, 2)}%
                    </b>
                  </div>
                </>
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
    shiftRate: user.shiftRate ?? 0,
    hourlyRate: user.hourlyRate ?? 0,
    percent: user.percent ?? 0,
    defaultStart: user.defaultStart ?? '10:00',
    defaultEnd: user.defaultEnd ?? '22:00',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isMe = user.id === me.id;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...f };
    if (!body.password) delete body.password;
    try {
      await api(isNew ? '/admin/users' : `/admin/users/${user.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? 'Сотрудник добавлен. Теперь заполните ему график.' : 'Изменения сохранены');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' });
      toast('Учётная запись удалена');
      onSaved();
    } catch (err) {
      setConfirm(false);
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Новый сотрудник' : user.name} sub={isNew ? null : user.login} onClose={onClose}>
      <form className="form" onSubmit={submit} autoComplete="off">
        <Field label="Имя">
          <input value={f.name} onChange={set('name')} required maxLength={80} />
        </Field>
        <div className="row2">
          <Field label="Логин" hint="Латиница, цифры, . _ -">
            <input value={f.login} onChange={set('login')} required autoCapitalize="none" autoCorrect="off" />
          </Field>
          <Field label={isNew ? 'Пароль' : 'Новый пароль'} hint={isNew ? 'Не короче 8 символов' : 'Пусто — не менять'}>
            <input value={f.password} onChange={set('password')} required={isNew} minLength={8} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Роль">
          <select value={f.role} onChange={set('role')} disabled={isMe}>
            <option value="operator">Сотрудник (работает по графику)</option>
            <option value="admin">Администратор</option>
          </select>
        </Field>
        {f.role === 'operator' && (
          <>
            <div className="form-group-title">Смена по умолчанию</div>
            <div className="row2">
              <Field label="Начало">
                <input type="time" value={f.defaultStart} onChange={set('defaultStart')} required />
              </Field>
              <Field label="Конец" hint={f.defaultEnd <= f.defaultStart ? 'на следующий день' : null}>
                <input type="time" value={f.defaultEnd} onChange={set('defaultEnd')} required />
              </Field>
            </div>
            <div className="form-group-title">Ставки</div>
            <div className="row3">
              <Field label="За смену, сом">
                <MoneyInput value={f.shiftRate} onChange={set('shiftRate')} />
              </Field>
              <Field label="В час, сом">
                <MoneyInput value={f.hourlyRate} onChange={set('hourlyRate')} />
              </Field>
              <Field label="% прибыли">
                <MoneyInput value={f.percent} onChange={set('percent')} />
              </Field>
            </div>
            <p className="small muted">
              Зарплата за смену = ставка за смену + часы × ставка в час + % от прибыли. Новые ставки применяются к сменам с сегодняшнего дня,
              прошедшие смены не пересчитываются.
            </p>
          </>
        )}
        {!isNew && !isMe && (
          <label className="check">
            <input type="checkbox" checked={f.active} onChange={set('active')} />
            <span>Учётная запись активна (может входить)</span>
          </label>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-actions">
          {!isNew && !isMe && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirm(true)}>
              Удалить
            </button>
          )}
          <button className="btn btn-primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
      {confirm && (
        <Confirm
          title={`Удалить «${user.name}»?`}
          text="Вход станет невозможен, будущие смены уберутся из графика. История смен и выплат сохранится в статистике."
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(false)}
        />
      )}
    </Modal>
  );
}
