import { useEffect, useState } from 'react';
import { getNotifications, type NotificationItem } from '../lib/api';

const FALLBACK: NotificationItem[] = [
  { id: 'n1', title: 'Benvingut al portal', body: 'Gràcies per formar part de la xarxa de partners de POLSER SEGURETAT. Ja podeu registrar referits i consultar la vostra cartera.', image: null, created_at: '2026-09-05T09:00:00Z' },
  { id: 'n2', title: 'Campanya Setmana', body: 'Aquesta setmana us proposem prioritzar el servei de videovigilància: condicions especials per a nous clients.', image: null, created_at: '2026-09-08T12:00:00Z' },
];

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>(FALLBACK);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getNotifications()
      .then((res) => {
        if (active) {
          setItems(res.data ?? FALLBACK);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const markRead = (id: string) => setReadIds((prev) => new Set(prev).add(id));

  const unread = items.filter((n) => !readIds.has(n.id)).length;

  return (
    <div className="page-inner">
      <h1 className="page-title">Notificacions</h1>
      <p className="page-sub">
        Avisos i campanyes de POLSER SEGURETAT.
        {unread > 0 && <span className="notif-unread-count">{unread} pendents</span>}
      </p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : items.length === 0 ? (
        <p className="empty">No hi ha cap notificació.</p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const isRead = readIds.has(n.id);
            return (
              <li className={`notif-item${isRead ? '' : ' unread'}`} key={n.id}>
                <span className="notif-dot" aria-hidden="true" />
                <div className="notif-body">
                  <strong>{n.title}</strong>
                  {n.body && <p>{n.body}</p>}
                  <span>{formatDate(n.created_at)}</span>
                </div>
                {!isRead && (
                  <button type="button" className="btn-ghost notif-action" onClick={() => markRead(n.id)}>
                    Marcar llegida
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}