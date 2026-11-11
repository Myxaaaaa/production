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
        <div className="brand brand-light">
          <img src="/icon.svg" alt="" width="36" height="36" />
          <span>Смены</span>
        </div>
        <div className="login-pitch">
          <h2>График, прибыль и зарплата — в одном месте</h2>
          <ul>
            <li>
              <Icon name="calendar" size={18} /> Смены по графику, без ручного открытия
            </li>
            <li>
              <Icon name="slash" size={18} /> Невыходы с причиной — отметит сотрудник или администратор
            </li>
            <li>
              <Icon name="chart" size={18} /> Аналитика прибыли и прогноз на месяц
            </li>
          </ul>
        </div>
      </aside>
      <main className="login-main">
        <form className="login" onSubmit={submit}>
          <img src="/icon.svg" alt="" width="48" height="48" className="login-logo" />
          <h1>Вход</h1>
          <p className="muted">Войдите под своей учётной записью</p>
          <Field label="Логин">
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              autoFocus
            />
          </Field>
          <Field label="Пароль">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </main>
    </div>
  );
}
