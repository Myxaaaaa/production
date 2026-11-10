import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { api } from './lib.js';
import { Icon, Loading } from './components/ui.jsx';
import { Login } from './pages/Login.jsx';
import { ShiftPage } from './pages/Shift.jsx';
import { EarningsPage } from './pages/Earnings.jsx';
import { RatingPage } from './pages/Rating.jsx';
import { NotificationsPage } from './pages/Notifications.jsx';
import { ProfilePage } from './pages/Profile.jsx';
import { AdminOverview } from './pages/admin/Overview.jsx';
import { AdminShifts } from './pages/admin/Shifts.jsx';
import { AdminUsers } from './pages/admin/Users.jsx';
import { AdminAdjustments } from './pages/admin/Adjustments.jsx';
import { AdminNotify } from './pages/admin/Notify.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const UnreadCtx = createContext({ unread: 0, refresh: () => {}, items: [] });
export const useUnread = () => useContext(UnreadCtx);

export function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    setUser(null);
  };

  if (user === undefined) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      {user.role === 'admin' ? <AdminApp /> : <OperatorApp />}
    </AuthCtx.Provider>
  );
}

function useNotifications(enabled) {
  const [state, setState] = useState({ unread: 0, items: [] });
  const refresh = useCallback(() => {
    if (!enabled) return;
    api('/notifications')
      .then(setState)
      .catch(() => {});
  }, [enabled]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  return { ...state, refresh };
}

function OperatorApp() {
  const notifications = useNotifications(true);
  const tabs = [
    { to: '/', icon: 'clock', label: 'Смена', end: true },
    { to: '/earnings', icon: 'wallet', label: 'Заработок' },
    { to: '/rating', icon: 'award', label: 'Рейтинг' },
    { to: '/notifications', icon: 'bell', label: 'Сообщения', badge: notifications.unread },
  ];
  return (
    <UnreadCtx.Provider value={notifications}>
      <Layout tabs={tabs}>
        <Routes>
          <Route path="/" element={<ShiftPage />} />
          <Route path="/earnings" element={<EarningsPage />} />
          <Route path="/rating" element={<RatingPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </UnreadCtx.Provider>
  );
}

function AdminApp() {
  const tabs = [
    { to: '/', icon: 'grid', label: 'Обзор', end: true },
    { to: '/shifts', icon: 'clock', label: 'Смены' },
    { to: '/users', icon: 'users', label: 'Сотрудники' },
    { to: '/adjustments', icon: 'gift', label: 'Бонусы' },
    { to: '/notify', icon: 'send', label: 'Рассылка' },
  ];
  return (
    <Layout tabs={tabs}>
      <Routes>
        <Route path="/" element={<AdminOverview />} />
        <Route path="/shifts" element={<AdminShifts />} />
        <Route path="/users" element={<AdminUsers />} />
        <Route path="/adjustments" element={<AdminAdjustments />} />
        <Route path="/notify" element={<AdminNotify />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function Layout({ tabs, children }) {
  const { user } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>Смены</span>
        </div>
        <nav className="sidenav" aria-label="Разделы">
          {tabs.map((t) => (
            <NavItem key={t.to} {...t} />
          ))}
        </nav>
        <Link to="/profile" className="me" aria-label="Профиль">
          <span className="me-name">{user.name}</span>
          <span className="avatar">{user.name.trim()[0]?.toUpperCase() || '?'}</span>
        </Link>
      </header>
      <main className="content">{children}</main>
      <nav className="tabbar" aria-label="Разделы">
        {tabs.map((t) => (
          <NavItem key={t.to} {...t} />
        ))}
      </nav>
    </div>
  );
}

function NavItem({ to, icon, label, end, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon">
        <Icon name={icon} />
        {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
      </span>
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}
