import { useEffect, useMemo, useState } from 'react';
import { getNotifications, markNotificationRead, type NotificationItem } from '../lib/api';

type Bucket = 'today' | 'week' | 'month' | 'old';

const BUCKET_ORDER: Bucket[] = ['today', 'week', 'month', 'old'];
const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'Avui',
  week: 'Aquesta setmana',
  month: 'Aquest mes',
  old: 'Fa temps',
};

/** Classifica una data en un dels buckets temporals del panell. */
function bucketOf(iso?: string): Bucket {
  if (!iso) return 'old';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'old';
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startToday - startItem) / dayMs);
  if (days <= 0) return 'today';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'old';
}

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getNotifications()
      .then((res) => {
        if (!active) return;
        setItems(res.data ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("No s'han pogut carregar les notificacions.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Estat de lectura persistent al servidor (notification_deliveries.read_at).
  // Optimista: actualitzem la UI de seguida i, si falla, ho revertim.
  const markRead = async (deliveryId: string) => {
    setItems((prev) =>
      prev.map((n) =>
        n.delivery_id === deliveryId && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
      ),
    );
    try {
      await markNotificationRead(deliveryId);
    } catch {
      setItems((prev) =>
        prev.map((n) => (n.delivery_id === deliveryId ? { ...n, read_at: null } : n)),
      );
    }
  };

  const unread = items.filter((n) => !n.read_at).length;

  const groups = useMemo(() => {
    const map: Record<Bucket, NotificationItem[]> = { today: [], week: [], month: [], old: [] };
    for (const n of items) map[bucketOf(n.created_at)].push(n);
    return map;
  }, [items]);

  return (
    <div className="page-inner">
      <h1 className="page-title">Notificacions</h1>
      <p className="page-sub">
        Avisos i campanyes de POLSER SEGURETAT.
        {unread > 0 && <span className="notif-unread-count">{unread} pendents</span>}
      </p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : error ? (
        <p className="empty">{error}</p>
      ) : items.length === 0 ? (
        <p className="empty">No hi ha cap notificació.</p>
      ) : (
        BUCKET_ORDER.filter((b) => groups[b].length > 0).map((b) => (
          <section className="notif-group" key={b}>
            <h2 className="notif-group-title">{BUCKET_LABEL[b]}</h2>
            <ul className="notif-list">
              {groups[b].map((n) => {
                const isRead = !!n.read_at;
                return (
                  <li className={`notif-item${isRead ? '' : ' unread'}`} key={n.delivery_id}>
                    <span className="notif-dot" aria-hidden="true" />
                    <div className="notif-body">
                      <strong>{n.title}</strong>
                      {n.body && <p>{n.body}</p>}
                      <span>{formatDate(n.created_at)}</span>
                    </div>
                    {!isRead && (
                      <button
                        type="button"
                        className="btn-ghost notif-action"
                        onClick={() => markRead(n.delivery_id)}
                      >
                        Marcar llegida
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
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
