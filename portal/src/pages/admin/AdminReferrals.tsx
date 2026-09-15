import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRecords, type Referral, type ReferralEvent, type Partner } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import {
  REFERRAL_STATUS,
  REFERRAL_STATUS_TONE,
  REFERRAL_STATUS_ORDER,
  fmtDate,
  fmtEuro,
} from '../../lib/adminFormat';

type ReferralWithExpand = Referral & { expand?: { partner?: Partner } };

export default function AdminReferrals() {
  const [items, setItems] = useState<ReferralWithExpand[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReferralWithExpand | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const parts: string[] = [];
    if (status) parts.push(`status = "${status}"`);
    if (search.trim()) {
      const q = search.trim().replace(/"/g, '\\"');
      parts.push(`(referral_code ~ "${q}" || client_name ~ "${q}")`);
    }
    listRecords<ReferralWithExpand>('referrals', {
      filter: parts.join(' && '),
      sort: '-created_at',
      page,
      perPage: 25,
      expand: 'partner',
    })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.totalItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Referits</h1>
          <p className="admin-page-sub">{total} referits (visió global; inclou dades de client)</p>
        </div>
      </div>

      <AdminCard>
        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="Cerca per codi o client…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <select
            className="admin-input"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            <option value="">Tots els estats</option>
            {REFERRAL_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {REFERRAL_STATUS[s]}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha referits." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Codi</th>
                  <th>Partner</th>
                  <th>Client</th>
                  <th>Estat</th>
                  <th>Comissió</th>
                  <th>Data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.referral_code ?? '—'}</td>
                    <td>
                      {r.expand?.partner ? (
                        <Link to={`/admin/partners/${r.expand.partner.id}`} className="admin-link">
                          {r.expand.partner.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{r.client_name ?? '—'}</td>
                    <td>
                      <Badge tone={REFERRAL_STATUS_TONE[r.status]}>{REFERRAL_STATUS[r.status] ?? r.status}</Badge>
                    </td>
                    <td>{fmtEuro(r.partner_commission_alta)}</td>
                    <td>{fmtDate(r.created)}</td>
                    <td>
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setDetail(r)}>
                        Detall
                      </button>
                    </td>
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

      <ReferralDetailModal referral={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function ReferralDetailModal({ referral, onClose }: { referral: ReferralWithExpand | null; onClose: () => void }) {
  const [events, setEvents] = useState<ReferralEvent[]>([]);

  useEffect(() => {
    if (!referral) return;
    listRecords<ReferralEvent>('referral_events', { filter: `referral = "${referral.id}"`, sort: 'created_at', perPage: 100 })
      .then((res) => setEvents(res.items))
      .catch(() => setEvents([]));
  }, [referral]);

  if (!referral) return null;

  const rows: Array<[string, string]> = [
    ['Estat', REFERRAL_STATUS[referral.status] ?? referral.status],
    ['Partner', referral.expand?.partner?.name ?? referral.partner ?? '—'],
    ['Servei', referral.service ?? '—'],
    ['Client', referral.client_name ?? '—'],
    ['Telèfon', referral.client_phone ?? '—'],
    ['Correu', referral.client_email ?? '—'],
    ['Adreça', referral.client_address ?? '—'],
    ['Comissió alta', fmtEuro(referral.partner_commission_alta)],
    ['Comissió recurrent', fmtEuro(referral.partner_commission_recurrente)],
    ['Odoo oportunitat', String(referral.odo_opportunity_id ?? '—')],
    ['Notes', referral.notes ?? '—'],
  ];

  return (
    <Modal open={Boolean(referral)} title={`Referit ${referral.referral_code ?? ''}`} onClose={onClose} wide>
      <dl className="admin-dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="admin-subtitle">Històric</h3>
      {events.length === 0 ? (
        <EmptyState message="Sense esdeveniments." />
      ) : (
        <ul className="admin-timeline">
          {events.map((ev) => (
            <li key={ev.id}>
              <span className="admin-sub">{fmtDate(ev.created)}</span>{' '}
              {ev.from_status ? `${REFERRAL_STATUS[ev.from_status] ?? ev.from_status} → ` : ''}
              <strong>{REFERRAL_STATUS[ev.to_status] ?? ev.to_status}</strong>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
