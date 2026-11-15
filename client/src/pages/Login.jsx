import { useState } from 'react';
import { api } from '../lib.js';
import { Field, Icon } from '../components/ui.jsx';

export function Login({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api('/auth/login', { method: 'POST', body: { login, password } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <aside className="login-art" aria-hidden="true">
        <div className="login-art-inner">
          <img src="/icon.svg" alt="" width="48" height="48" />
          <h2>Зарплата, которая капает сама</h2>
          <ul>
            <li>
              <Icon name="drop" size={18} /> Прибыль приходит прямо с рабочего сайта
            </li>
            <li>
              <Icon name="coins" size={18} /> Оклад начисляется каждый день, без смен
            </li>
            <li>
              <Icon name="flame" size={18} /> Видно, в какие часы работа приносит больше всего
            </li>
          </ul>
          <div className="drops">
            <i />
            <i />
            <i />
          </div>
        </div>
      </aside>
      <form className="login" onSubmit={submit}>
        <img className="login-logo" src="/icon.svg" alt="" width="44" height="44" />
        <h1>Вход в «Смены»</h1>
        <p className="muted">Войдите под своей учётной записью</p>
        <Field label="Логин">
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required autoFocus />
        </Field>
        <Field label="Пароль">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
