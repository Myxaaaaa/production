import { useState } from 'react';
import { api, useApi, money, num, time } from '../../lib.js';
import { ErrorBox, Field, Icon, Loading, Modal, MoneyInput, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../App.jsx';

export function AdminUsers() {
  const { data, error, loading, reload } = useApi('/admin/users');
  const [editing, setEditing] = useState(null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Сотрудники</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          <Icon name="plus" size={18} /> Добавить
        </button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <ul className="list">
          {(data || []).map((u) => (
            <li key={u.id}>
              <button className={`list-row list-btn ${u.active ? '' : 'dimmed'}`} onClick={() => setEditing(u)}>
                <div className="user-row">
                  <span className="avatar">{u.name.trim()[0]?.toUpperCase()}</span>
                  <div>
                    <div className="list-title">
                      {u.name}
                      {u.role === 'admin' && <span className="tag">админ</span>}
                      {!u.active && <span className="tag tag-off">заблокирован</span>}
                      {u.openSince && <span className="tag tag-live">на смене с {time(u.openSince)}</span>}
                    </div>
                    <div className="muted small">{u.login}</div>
                    {u.role === 'operator' && (
                      <div className="muted small">
                        {money(u.shiftRate)}/смена · {money(u.hourlyRate)}/ч · {num(u.percent, 2)}%
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
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
    applyToOpenShift: false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      toast(isNew ? 'Сотрудник добавлен' : 'Изменения сохранены');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Удалить учётную запись «${user.name}»? Вход станет невозможен, история смен сохранится в статистике.`)) return;
    try {
      await api(`/admin/users/${user.id}`, { method: 'DELETE' });
      toast('Учётная запись удалена');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

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
            <option value="operator">Оператор</option>
            <option value="admin">Администратор</option>
          </select>
        </Field>
        {f.role === 'operator' && (
          <>
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
            <p className="muted small">
              Зарплата за смену = ставка за смену + часы × ставка в час + % от прибыли. Новые ставки действуют для новых смен.
            </p>
            {user.openSince && (
              <label className="check">
                <input type="checkbox" checked={f.applyToOpenShift} onChange={set('applyToOpenShift')} />
                Применить новые ставки и к текущей открытой смене
              </label>
            )}
          </>
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
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Удалить
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
