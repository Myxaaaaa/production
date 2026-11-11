import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib.js';
import { Avatar, Icon, Loading } from './components/ui.jsx';
import { Login } from './pages/Login.jsx';
import { HomePage } from './pages/Home.jsx';
import { EarningsPage } from './pages/Earnings.jsx';
import { RatingPage } from './pages/Rating.jsx';
import { NotificationsPage } from './pages/Notifications.jsx';
import { ProfilePage } from './pages/Profile.jsx';
import { AdminOverview } from './pages/admin/Overview.jsx';
import { AdminSchedule } from './pages/admin/Schedule.jsx';
import { AdminAnalytics } from './pages/admin/Analytics.jsx';
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

  if (user === undefined) return <div className="boot"><Loading /></div>;
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
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { ...state, refresh };
}

function OperatorApp() {
  const notifications = useNotifications(true);
  const tabs = [
    { to: '/', icon: 'home', label: 'Главная', end: true },
    { to: '/earnings', icon: 'wallet', label: 'Заработок' },
    { to: '/rating', icon: 'award', label: 'Рейтинг' },
    { to: '/notifications', icon: 'bell', label: 'Сообщения', badge: notifications.unread },
  ];
  return (
    <UnreadCtx.Provider value={notifications}>
      <Layout tabs={tabs}>
        <Routes>
          <Route path="/" element={<HomePage />} />
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
    { to: '/schedule', icon: 'calendar', label: 'График' },
    { to: '/analytics', icon: 'chart', label: 'Аналитика' },
    { to: '/users', icon: 'users', label: 'Сотрудники' },
    { to: '/adjustments', icon: 'gift', label: 'Бонусы и штрафы', short: 'Бонусы', more: true },
    { to: '/notify', icon: 'send', label: 'Рассылка', more: true },
  ];
  return (
    <Layout tabs={tabs}>
      <Routes>
        <Route path="/" element={<AdminOverview />} />
        <Route path="/schedule" element={<AdminSchedule />} />
        <Route path="/analytics" element={<AdminAnalytics />} />
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
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const main = tabs.filter((t) => !t.more);
  const more = tabs.filter((t) => t.more);
  const moreActive = more.some((t) => pathname.startsWith(t.to)) || pathname === '/profile';

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width="32" height="32" />
          <span>
            Смены
            <small>{user.role === 'admin' ? 'администратор' : 'сотрудник'}</small>
          </span>
        </Link>
        <nav className="side-nav" aria-label="Разделы">
          {tabs.map((t) => (
            <NavItem key={t.to} {...t} />
          ))}
        </nav>
        <NavLink to="/profile" className={({ isActive }) => `side-me ${isActive ? 'active' : ''}`}>
          <Avatar name={user.name} size="sm" />
          <span className="side-me-text">
            <b>{user.name}</b>
            <small>{user.login}</small>
          </span>
        </NavLink>
      </aside>

      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>Смены</span>
        </Link>
        <Link to="/profile" className="topbar-me" aria-label="Профиль">
          <Avatar name={user.name} size="sm" />
        </Link>
      </header>

      <main className="content">{children}</main>

      <nav className="tabbar" aria-label="Разделы">
        {main.map((t) => (
          <NavItem key={t.to} {...t} />
        ))}
        {more.length > 0 && (
          <button className={`nav-item ${moreActive ? 'active' : ''}`} onClick={() => setMoreOpen(true)}>
            <span className="nav-icon">
              <Icon name="more" />
            </span>
            <span className="nav-label">Ещё</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-grab" aria-hidden="true" />
            {[...more, { to: '/profile', icon: 'user', label: 'Профиль' }].map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => `sheet-item ${isActive ? 'active' : ''}`}>
                <Icon name={t.icon} />
                {t.label}
                <Icon name="right" size={18} />
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ to, icon, label, short, end, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon">
        <Icon name={icon} />
        {badge > 0 && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
      </span>
      <span className="nav-label">{short ?? label}</span>
      <span className="nav-label-full">{label}</span>
    </NavLink>
  );
}
