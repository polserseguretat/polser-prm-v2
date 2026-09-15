import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  listRecords,
  uploadRecord,
  adminSendNotification,
  adminAudit,
  ApiError,
  type Notification,
  type NotificationDelivery,
  type PartnerUser,
} from '../../lib/adminApi';
import { BASE_URL } from '../../lib/api';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { NOTIFICATION_STATUS, AUDIENCE, CHANNEL, fmtDate, fmtDateTime } from '../../lib/adminFormat';

const STATUS_TONE: Record<string, string> = { draft: 'gray', queued: 'amber', sent: 'green', failed: 'red' };

export default function AdminNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<Notification | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<Notification>('notifications', { sort: '-created', perPage: 100 })
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendNow = async (n: Notification) => {
    if (!confirm(`Enviar ara "${n.title}"?`)) return;
    try {
      const res = await adminSendNotification(n.id);
      adminAudit({ action: 'send', entity: 'notifications', entity_id: n.id, payload: { delivered: res.data.delivered } }).catch(() => undefined);
      alert(`Enviada a ${res.data.delivered} usuaris.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut enviar.');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Notificacions</h1>
          <p className="admin-page-sub">Campanyes in-app per als partners</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setComposeOpen(true)}>
          Nova notificació
        </button>
      </div>

      <AdminCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha notificacions." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Títol</th>
                  <th>Públic</th>
                  <th>Canal</th>
                  <th>Estat</th>
                  <th>Data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <strong>{n.title}</strong>
                      {n.body && <span className="admin-sub">{n.body.slice(0, 80)}</span>}
                    </td>
                    <td>{AUDIENCE[n.audience] ?? n.audience}</td>
                    <td>{CHANNEL[n.channel] ?? n.channel}</td>
                    <td>
                      <Badge tone={STATUS_TONE[n.status]}>{NOTIFICATION_STATUS[n.status] ?? n.status}</Badge>
                    </td>
                    <td>{fmtDate(n.sent_at || n.scheduled_at || n.created)}</td>
                    <td className="admin-row-actions">
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDeliveriesFor(n)}>
                        Entregues
                      </button>
                      {n.status !== 'sent' && (
                        <button type="button" className="admin-btn admin-btn-primary" onClick={() => sendNow(n)}>
                          Envia ara
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onCreated={() => { setComposeOpen(false); load(); }} />
      <DeliveriesModal notification={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
    </div>
  );
}

function ComposeModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [channel, setChannel] = useState('inapp');
  const [scheduledAt, setScheduledAt] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent, sendImmediately: boolean) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('title', title);
      fd.set('body', body);
      fd.set('audience', audience);
      fd.set('channel', channel);
      if (scheduledAt) fd.set('scheduled_at', new Date(scheduledAt).toISOString());
      if (image) fd.set('image', image);
      fd.set('status', sendImmediately ? 'queued' : 'draft');
      const created = await uploadRecord<Notification>('notifications', fd);
      if (sendImmediately) {
        await adminSendNotification(created.id);
      }
      adminAudit({ action: 'create', entity: 'notifications', entity_id: created.id }).catch(() => undefined);
      setTitle('');
      setBody('');
      setScheduledAt('');
      setImage(null);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut crear la notificació.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Nova notificació" onClose={onClose}>
      <form className="admin-form" onSubmit={(e) => submit(e, true)}>
        <label className="admin-field">
          <span>Títol</span>
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Missatge</span>
          <textarea className="admin-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Públic</span>
            <select className="admin-input" value={audience} onChange={(e) => setAudience(e.target.value)}>
              {Object.entries(AUDIENCE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Canal</span>
            <select className="admin-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {Object.entries(CHANNEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Programada (opcional)</span>
            <input className="admin-input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <label className="admin-field">
            <span>Imatge (opcional)</span>
            <input className="admin-input" type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" disabled={busy} onClick={(e) => submit(e, false)}>
            Desa esborrany
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Enviant…' : 'Envia ara'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeliveriesModal({ notification, onClose }: { notification: Notification | null; onClose: () => void }) {
  const [rows, setRows] = useState<Array<NotificationDelivery & { expand?: { user?: PartnerUser } }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!notification) return;
    setLoading(true);
    listRecords<NotificationDelivery & { expand?: { user?: PartnerUser } }>('notification_deliveries', {
      filter: `notification = "${notification.id}"`,
      sort: '-delivered_at',
      perPage: 200,
      expand: 'user',
    })
      .then((res) => setRows(res.items))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [notification]);

  const read = rows.filter((r) => r.read_at).length;

  return (
    <Modal open={Boolean(notification)} title={`Entregues · ${notification?.title ?? ''}`} onClose={onClose} wide>
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState message="Encara no s'ha entregat a cap usuari." />
      ) : (
        <>
          <p className="admin-sub">
            {rows.length} entregues · {read} llegides
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuari</th>
                  <th>Entregada</th>
                  <th>Llegida</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.expand?.user?.email ?? r.user}</td>
                    <td>{fmtDateTime(r.delivered_at)}</td>
                    <td>{r.read_at ? fmtDateTime(r.read_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="hint">Origen de les imatges: {BASE_URL || window.location.origin}</p>
    </Modal>
  );
}
