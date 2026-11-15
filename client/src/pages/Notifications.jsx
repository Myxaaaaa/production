import { useEffect, useRef } from 'react';
import { api, dateTime, dayLabel } from '../lib.js';
import { Empty, Icon, PageHead } from '../components/ui.jsx';
import { useUnread } from '../App.jsx';

const KIND = {
  info: { icon: 'bell', label: 'Сообщение' },
  payday: { icon: 'wallet', label: 'Зарплата' },
  bonus: { icon: 'gift', label: 'Бонус' },
  fine: { icon: 'x', label: 'Штраф' },
};

export function NotificationsPage() {
  const { items, unread, refresh } = useUnread();
  const marked = useRef(false);

  // При открытии отмечаем всё прочитанным, подсветку новых оставляем до ухода со страницы.
  useEffect(() => {
    if (unread > 0 && !marked.current) {
      marked.current = true;
      api('/notifications/read-all', { method: 'POST' }).then(() => setTimeout(refresh, 4000), () => {});
    }
  }, [unread, refresh]);

  return (
    <div className="page narrow">
      <PageHead title="Сообщения" subtitle={unread ? `${unread} новых` : 'Все прочитаны'} />
      {items.length === 0 ? (
        <Empty icon="bell">Сообщений пока нет</Empty>
      ) : (
        <ul className="notes">
          {items.map((n) => (
            <li key={n.id} className={`note note-${n.kind} ${n.read ? '' : 'note-new'}`}>
              <span className="note-icon">
                <Icon name={KIND[n.kind]?.icon || 'bell'} size={18} />
              </span>
              <div className="note-main">
                <div className="note-title">{n.title}</div>
                {n.paydayDate && <div className="note-date">Дата выдачи: {dayLabel(n.paydayDate)}</div>}
                {n.body && <div className="note-body">{n.body}</div>}
                <div className="muted small">
                  {KIND[n.kind]?.label} · {dateTime(n.createdAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
