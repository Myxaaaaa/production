import { useState } from 'react';
import { api, money, num } from '../lib.js';
import { Field, Icon, useToast } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.repeat) return setError('Новые пароли не совпадают');
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, next: form.next } });
      setForm({ current: '', next: '', repeat: '' });
      toast('Пароль изменён. На других устройствах потребуется войти заново.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Профиль</h1>
      </div>
      <div className="card profile">
        <div className="avatar avatar-lg">{user.name.trim()[0]?.toUpperCase()}</div>
        <div>
          <div className="list-title">{user.name}</div>
          <div className="muted">
            {user.login} · {user.role === 'admin' ? 'Администратор' : 'Оператор'}
          </div>
          {user.role === 'operator' && (
            <div className="muted small">
              Ставки: {money(user.shiftRate)} за смену · {money(user.hourlyRate)}/ч · {num(user.percent, 2)}% от прибыли
            </div>
          )}
        </div>
      </div>

      <h2 className="section-title">Сменить пароль</h2>
      <form className="card form" onSubmit={submit}>
        <Field label="Текущий пароль">
          <input type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required />
        </Field>
        <Field label="Новый пароль" hint="Не короче 8 символов">
          <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Повторите новый пароль">
          <input type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" required />
        </Field>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          Сохранить пароль
        </button>
      </form>

      <button className="btn btn-ghost btn-block logout" onClick={logout}>
        <Icon name="logout" size={18} /> Выйти
      </button>
    </div>
  );
}
