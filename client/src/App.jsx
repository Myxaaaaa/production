import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { api, useApi } from './lib.js';
import { Avatar, Icon, Loading } from './components/ui.jsx';
import { Login } from './pages/Login.jsx';
import { HomePage } from './pages/Home.jsx';
import { EarningsPage } from './pages/Earnings.jsx';
import { StatsPage } from './pages/Stats.jsx';
import { NotificationsPage } from './pages/Notifications.jsx';
import { ProfilePage } from './pages/Profile.jsx';
import { AdminOverview } from './pages/admin/Overview.jsx';
import { AdminAnalytics } from './pages/admin/Analytics.jsx';
import { AdminProfit } from './pages/admin/Profit.jsx';
import { AdminPayroll } from './pages/admin/Payroll.jsx';
import { AdminUsers } from './pages/admin/Users.jsx';
import { AdminNotify } from './pages/admin/Notify.jsx';
import { MorePage } from './pages/admin/More.jsx';
import { AdminRating } from './pages/admin/Rating.jsx';
import { AdvancesPage } from './pages/Advances.jsx';

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

  if (user === undefined) return <div className="boot"><Loading /></div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      {user.role === 'admin' ? <AdminApp /> : <OperatorApp />}
    </AuthCtx.Provider>
  );
}

function useNotifications() {
  const [state, setState] = useState({ unread: 0, items: [] });
  const refresh = useCallback(() => {
    api('/notifications')
      .then(setState)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { ...state, refresh };
}

function OperatorApp() {
  const notifications = useNotifications();
  const tabs = [
    { to: '/', icon: 'home', label: 'Главная', end: true },
    { to: '/earnings', icon: 'wallet', label: 'Заработок' },
    { to: '/stats', icon: 'chart', label: 'Аналитика' },
    { to: '/advances', icon: 'coins', label: 'Аванс' },
    { to: '/notifications', icon: 'bell', label: 'Сообщения', badge: notifications.unread },
  ];
  return (
    <UnreadCtx.Provider value={notifications}>
      <Layout tabs={tabs} mobileTabs={tabs}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/earnings" element={<EarningsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/advances" element={<AdvancesPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </UnreadCtx.Provider>
  );
}

const ADMIN_TABS = [
  { to: '/', icon: 'grid', label: 'Обзор', end: true },
  { to: '/analytics', icon: 'chart', label: 'Аналитика' },
  { to: '/payroll', icon: 'wallet', label: 'Зарплата' },
  { to: '/rating', icon: 'trophy', label: 'Рейтинг' },
  { to: '/profit', icon: 'drop', label: 'Поступления' },
  { to: '/users', icon: 'users', label: 'Сотрудники' },
  { to: '/notify', icon: 'send', label: 'Рассылка' },
];

function AdminApp() {
  // Счётчик новых заявок на аванс — на вкладке «Зарплата».
  const adv = useApi('/admin/advances/pending', { refreshMs: 30000 });
  const pending = adv.data?.pending || 0;
  useEffect(() => {
    const on = () => adv.reload();
    window.addEventListener('advances:changed', on);
    return () => window.removeEventListener('advances:changed', on);
  });
  const tabs = ADMIN_TABS.map((t) => (t.to === '/payroll' ? { ...t, badge: pending } : t));
  const mobile = [...tabs.slice(0, 4), { to: '/more', icon: 'more', label: 'Ещё' }];
  return (
    <Layout tabs={tabs} mobileTabs={mobile}>
      <Routes>
        <Route path="/" element={<AdminOverview />} />
        <Route path="/analytics" element={<AdminAnalytics />} />
        <Route path="/profit" element={<AdminProfit />} />
        <Route path="/payroll" element={<AdminPayroll />} />
        <Route path="/rating" element={<AdminRating />} />
        <Route path="/users" element={<AdminUsers />} />
        <Route path="/notify" element={<AdminNotify />} />
        <Route path="/more" element={<MorePage tabs={ADMIN_TABS.slice(4)} />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <img src="/icon.svg" alt="" width="30" height="30" />
      <span>Смены</span>
    </Link>
  );
}

function Layout({ tabs, mobileTabs, children }) {
  const { user } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Разделы">
          {tabs.map((t) => (
            <NavItem key={t.to} {...t} />
          ))}
        </nav>
        <Link to="/profile" className="side-me">
          <Avatar name={user.name} size="sm" />
          <div>
            <b>{user.name}</b>
            <span>{user.role === 'admin' ? 'Администратор' : 'Сотрудник'}</span>
          </div>
          <Icon name="settings" size={17} />
        </Link>
      </aside>
      <header className="topbar">
        <Brand />
        <Link to="/profile" aria-label="Профиль">
          <Avatar name={user.name} size="sm" />
        </Link>
      </header>
      <main className="content">{children}</main>
      <nav className="tabbar" aria-label="Разделы">
        {mobileTabs.map((t) => (
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
