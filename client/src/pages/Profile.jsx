import { useEffect, useState } from 'react';
import { api, money, num, useApi } from '../lib.js';
import { Avatar, Field, Icon, MoneyInput, PageHead, Section, useToast } from '../components/ui.jsx';
import { ExtensionCard } from '../components/insights.jsx';
import { useAuth } from '../App.jsx';

const TZS = ['Asia/Bishkek', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Dushanbe', 'Europe/Moscow', 'Europe/Istanbul', 'Asia/Dubai', 'UTC'];

export function ProfilePage() {
  const { user, logout } = useAuth();
  return (
    <div className="page narrow">
      <PageHead title="Профиль" />
      <div className="card profile">
        <Avatar name={user.name} size="lg" />
        <div>
          <h2>{user.name}</h2>
          <div className="muted">
            {user.login} · {user.role === 'admin' ? 'Администратор' : 'Сотрудник'}
          </div>
          {user.role === 'operator' && (
            <div className="muted small">
              Оклад {money(user.dailyRate)} в день · {num(user.percent, 2)}% от прибыли
              {user.dailyGoal > 0 && ` · цель ${money(user.dailyGoal)} в день`}
            </div>
          )}
        </div>
      </div>

      {user.role === 'operator' && (
        <Section title="Расширение">
          <ExtensionCard />
        </Section>
      )}
      {user.role === 'admin' && <SettingsCard />}
      <PasswordCard />

      <button className="btn btn-ghost btn-block" onClick={logout}>
        <Icon name="logout" size={18} /> Выйти
      </button>
    </div>
  );
}

function SettingsCard() {
  const toast = useToast();
  const { data } = useApi('/admin/settings');
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      setF(await api('/admin/settings', { method: 'PUT', body: f }));
      toast('Настройки сохранены');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Section title="Настройки компании">
      <form className="card form" onSubmit={save}>
        <div className="row2">
          <Field label="Часовой пояс" hint="По нему считаются дни и часы">
            <select value={f.tz} onChange={set('tz')}>
              {[...new Set([f.tz, ...TZS])].map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Цель команды на день, сом" hint="0 — без цели">
            <MoneyInput value={f.teamDailyGoal} onChange={set('teamDailyGoal')} />
          </Field>
        </div>
        <div className="row2">
          <Field label="Лучшее окно, часов" hint="Длина периода для поиска самого прибыльного времени">
            <input type="number" min="1" max="8" value={f.windowHours} onChange={set('windowHours')} />
          </Field>
          <Field label="Простой, минут" hint="Через сколько без прибыли подсвечивать сотрудника онлайн">
            <input type="number" min="5" max="600" value={f.idleMinutes} onChange={set('idleMinutes')} />
          </Field>
        </div>
        <div className="form-actions">
          <a className="btn btn-ghost" href="/api/admin/backup" download>
            <Icon name="download" size={17} /> Резервная копия базы
          </a>
          <button className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </Section>
  );
}

function PasswordCard() {
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
    <Section title="Сменить пароль">
      <form className="card form" onSubmit={submit}>
        <Field label="Текущий пароль">
          <input type="password" value={form.current} onChange={set('current')} autoComplete="current-password" required />
        </Field>
        <div className="row2">
          <Field label="Новый пароль" hint="Не короче 8 символов">
            <input type="password" value={form.next} onChange={set('next')} autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Повторите">
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
  );
}
