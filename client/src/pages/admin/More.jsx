import { Link } from 'react-router-dom';
import { Icon, PageHead } from '../../components/ui.jsx';

export function MorePage({ tabs }) {
  const items = [...tabs, { to: '/profile', icon: 'settings', label: 'Профиль и настройки' }];
  return (
    <div className="page narrow">
      <PageHead title="Ещё" />
      <ul className="card list">
        {items.map((t) => (
          <li key={t.to}>
            <Link to={t.to} className="more-link">
              <span className="more-icon">
                <Icon name={t.icon} size={18} />
              </span>
              {t.label}
              <Icon name="chevron" size={18} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
