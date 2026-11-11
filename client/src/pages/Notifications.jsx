import { useEffect, useRef } from 'react';
import { api, dateTime, dayMonth } from '../lib.js';
import { Empty, Icon, PageHead } from '../components/ui.jsx';
import { useUnread } from '../App.jsx';

const KIND = {
  info: { icon: 'bell', label: 'Сообщение', tone: '' },
  payday: { icon: 'wallet', label: 'Зарплата', tone: 'tone-accent' },
  bonus: { icon: 'gift', label: 'Бонус', tone: 'tone-good' },
  fine: { icon: 'alert', label: 'Штраф', tone: 'tone-bad' },
};

export function NotificationsPage() {
  const { items, unread, refresh } = useUnread();
  const marked = useRef(false);

  // При открытии страницы отмечаем всё прочитанным, но подсветку оставляем до ухода.
  useEffect(() => {
    if (unread > 0 && !marked.current) {
      marked.current = true;
      api('/notifications/read-all', { method: 'POST' }).then(() => setTimeout(refresh, 4000), () => {});
    }
  }, [unread, refresh]);

  return (
    <div className="page narrow">
      <PageHead title="Сообщения" sub={unread ? `Новых: ${unread}` : 'Все сообщения прочитаны'} />
      {items.length === 0 ? (
        <Empty icon="bell">Сообщений пока нет</Empty>
      ) : (
        <ul className="list card">
          {items.map((n) => {
            const k = KIND[n.kind] ?? KIND.info;
            return (
              <li key={n.id} className={`list-row note ${n.read ? '' : 'note-new'}`}>
                <span className={`list-icon ${k.tone}`}>
                  <Icon name={k.icon} size={18} />
                </span>
                <div className="list-main">
                  <div className="list-title">{n.title}</div>
                  {n.paydayDate && <div className="note-date">Дата выдачи: {dayMonth(n.paydayDate)}</div>}
                  {n.body && <div className="note-body">{n.body}</div>}
                  <div className="list-sub">
                    {k.label} · {dateTime(n.createdAt)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
