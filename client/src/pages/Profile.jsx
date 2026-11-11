import { useState } from 'react';
import { api, money, num } from '../lib.js';
import { Avatar, Field, Icon, PageHead, Section, useToast } from '../components/ui.jsx';
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
      <PageHead title="Профиль" />
      <div className="card card-pad profile">
        <Avatar name={user.name} size="xl" />
        <div>
          <div className="profile-name">{user.name}</div>
          <div className="muted">
            {user.login} · {user.role === 'admin' ? 'Администратор' : 'Сотрудник'}
          </div>
          {user.role === 'operator' && (
            <div className="profile-rates">
              <span>{money(user.shiftRate)} за смену</span>
              <span>{money(user.hourlyRate)} в час</span>
              <span>{num(user.percent, 2)}% от прибыли</span>
              <span>
                смена {user.defaultStart}–{user.defaultEnd}
              </span>
            </div>
          )}
        </div>
      </div>

      <Section title="Сменить пароль">
        <form className="card card-pad form" onSubmit={submit}>
          <Field label="Текущий пароль">
            <input type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required />
          </Field>
          <div className="row2">
            <Field label="Новый пароль" hint="Не короче 8 символов">
              <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" minLength={8} required />
            </Field>
            <Field label="Повторите новый пароль">
              <input type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" required />
            </Field>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              Сохранить пароль
            </button>
          </div>
        </form>
      </Section>

      <button className="btn btn-ghost btn-block logout" onClick={logout}>
        <Icon name="logout" size={18} /> Выйти из аккаунта
      </button>
    </div>
  );
}
