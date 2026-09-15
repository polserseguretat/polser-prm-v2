import { useCallback, useEffect, useState } from 'react';
import { listRecords, type AdminAuditRecord } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState } from '../../components/admin/ui';
import { fmtDateTime } from '../../lib/adminFormat';

const TONE: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  invite: 'amber',
  send: 'green',
  login: 'gray',
  view_pii: 'red',
  other: 'gray',
};

export default function AdminAudit() {
  const [items, setItems] = useState<AdminAuditRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<AdminAuditRecord>('admin_audit', { sort: '-created', page, perPage: 50 })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.totalItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Auditoria</h1>
          <p className="admin-page-sub">{total} accions registrades</p>
        </div>
        <button type="button" className="admin-btn" onClick={load}>
          Actualitza
        </button>
      </div>

      <AdminCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="Encara no hi ha accions registrades." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Actor</th>
                  <th>Acció</th>
                  <th>Entitat</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDateTime(a.created)}</td>
                    <td>{a.actor || '—'}</td>
                    <td>
                      <Badge tone={TONE[a.action]}>{a.action}</Badge>
                    </td>
                    <td>
                      {a.entity || '—'} <span className="admin-sub">{a.entity_id || ''}</span>
                    </td>
                    <td>{a.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="admin-pagination">
            <button type="button" className="admin-btn admin-btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>
              Pàgina {page} de {totalPages}
            </span>
            <button type="button" className="admin-btn admin-btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Següent
            </button>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
