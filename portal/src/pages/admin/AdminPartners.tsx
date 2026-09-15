import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listRecords, adminInvitePartner, ApiError, type Partner } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Pagination, Modal } from '../../components/admin/ui';
import { PARTNER_STATUS, PARTNER_STATUS_TONE, PROFILE_LABEL, PARTNER_TYPE, fmtDate } from '../../lib/adminFormat';

const PER_PAGE = 25;

export default function AdminPartners() {
  const [items, setItems] = useState<Partner[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const parts: string[] = [];
    if (search.trim()) {
      const q = search.trim().replace(/"/g, '\\"');
      parts.push(`(name ~ "${q}" || nif ~ "${q}" || email ~ "${q}")`);
    }
    if (status) parts.push(`status = "${status}"`);
    const filter = parts.join(' && ');
    listRecords<Partner>('partners', { filter, sort: '-created_at', page, perPage: PER_PAGE })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.totalItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [search, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Partners</h1>
          <p className="admin-page-sub">{total} organitzacions</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setInviteOpen(true)}>
          Nou partner
        </button>
      </div>

      <AdminCard>
        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="Cerca per nom, NIF o correu…"
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
            {Object.entries(PARTNER_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha partners que coincideixin." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Perfil</th>
                  <th>Tipus</th>
                  <th>Estat</th>
                  <th>Alta</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/partners/${p.id}`} className="admin-link">
                        {p.name}
                      </Link>
                      <span className="admin-sub">{p.email || p.nif || '—'}</span>
                    </td>
                    <td>{PROFILE_LABEL[p.profile] ?? p.profile}</td>
                    <td>{PARTNER_TYPE[p.type] ?? p.type}</td>
                    <td>
                      <Badge tone={PARTNER_STATUS_TONE[p.status]}>{PARTNER_STATUS[p.status] ?? p.status}</Badge>
                    </td>
                    <td>{fmtDate(p.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </AdminCard>

      <InvitePartnerModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false);
          load();
        }}
      />
    </div>
  );
}

function InvitePartnerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invite_url: string; mail_sent: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await adminInvitePartner({ name: name.trim(), email: email.trim() });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut crear la invitació.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setName('');
    setEmail('');
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} title="Nou partner per invitació" onClose={close}>
      {result ? (
        <div className="admin-form">
          <p className={result.mail_sent ? 'admin-ok' : 'admin-warn'}>
            {result.mail_sent
              ? 'Invitació creada i correu enviat.'
              : 'Invitació creada, però el correu no s\'ha pogut enviar. Comparteix l\'enllaç manualment:'}
          </p>
          <input className="admin-input" readOnly value={result.invite_url} onFocus={(e) => e.target.select()} />
          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn-primary" onClick={onCreated}>
              Fet
            </button>
          </div>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-field">
            <span>Nom</span>
            <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="admin-field">
            <span>Correu electrònic</span>
            <input className="admin-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <p className="hint">El partner es crearà com a <strong>Afiliat</strong> (60 € per alta) fins que s'ascendeixi a col·laborador.</p>
          {error && <p className="error">{error}</p>}
          <div className="admin-actions">
            <button type="button" className="admin-btn admin-btn-ghost" onClick={close}>
              Cancel·la
            </button>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
              {busy ? 'Creant…' : 'Envia la invitació'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
