import { useCallback, useEffect, useState } from 'react';
import { adminOutboxHealth, adminRetryOutbox, listRecords, type OutboxHealth, type OutboxEvent } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, StatCard } from '../../components/admin/ui';
import { OUTBOX_STATUS, fmtDateTime } from '../../lib/adminFormat';

const STATUS_TONE: Record<string, string> = { pending: 'amber', ok: 'green', error: 'red', dead: 'red' };

export default function AdminOutbox() {
  const [health, setHealth] = useState<OutboxHealth | null>(null);
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      adminOutboxHealth(),
      listRecords<OutboxEvent>('outbox', { sort: '-created_at', perPage: 50 }),
    ])
      .then(([h, ev]) => {
        setHealth(h.data);
        setEvents(ev.items);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id: string) => {
    try {
      await adminRetryOutbox(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No s\'ha pogut reintentar.');
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!health) return null;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Odoo / Outbox</h1>
          <p className="admin-page-sub">Salut de la cua d'events cap a Odoo (JSON-2)</p>
        </div>
        <button type="button" className="admin-btn" onClick={load}>
          Actualitza
        </button>
      </div>

      <div className="admin-kpis">
        <StatCard label="Total events" value={health.total} />
        <StatCard label="Pendents" value={health.byStatus['pending'] || 0} />
        <StatCard label="Correctes" value={health.byStatus['ok'] || 0} />
        <StatCard label="Errors" value={health.byStatus['error'] || 0} />
        <StatCard label="Morts" value={health.byStatus['dead'] || 0} />
      </div>

      <AdminCard title={`Errors recents (${health.errors.length})`}>
        {health.errors.length === 0 ? (
          <EmptyState message="Cap error a la cua." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Acció</th>
                  <th>Entitat</th>
                  <th>Estat</th>
                  <th>Intents</th>
                  <th>Error</th>
                  <th>Actualitzat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {health.errors.map((r) => (
                  <tr key={r.id}>
                    <td>{r.action || '—'}</td>
                    <td>
                      {r.entity || '—'} <span className="admin-sub">{r.entity_id || ''}</span>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{OUTBOX_STATUS[r.status] ?? r.status}</Badge>
                    </td>
                    <td>{r.attempts}</td>
                    <td className="admin-error-cell">{r.last_error || '—'}</td>
                    <td>{fmtDateTime(r.updated_at)}</td>
                    <td>
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => retry(r.id)}>
                        Reintenta
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminCard title="Últims events">
        {events.length === 0 ? (
          <EmptyState message="Sense events." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Acció</th>
                  <th>Entitat</th>
                  <th>Estat</th>
                  <th>Intents</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.action}</td>
                    <td>{ev.entity}</td>
                    <td>
                      <Badge tone={STATUS_TONE[ev.status]}>{OUTBOX_STATUS[ev.status] ?? ev.status}</Badge>
                    </td>
                    <td>{ev.attempts}</td>
                    <td>{fmtDateTime(ev.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
