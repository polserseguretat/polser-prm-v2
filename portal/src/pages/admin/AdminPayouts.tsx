import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listRecords, updateRecord, adminRecordPayout, adminAudit, ApiError, type Payout, type Partner } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { PAYOUT_STATUS, fmtDate, fmtEuro } from '../../lib/adminFormat';

type PayoutWithExpand = Payout & { expand?: { partner?: Partner } };

const STATUS_TONE: Record<string, string> = {
  solicitada: 'amber',
  factura_rebuda: 'blue',
  en_proces: 'blue',
  pagada: 'green',
};

const TOTALS = ['', 'solicitada', 'factura_rebuda', 'en_proces', 'pagada'];

export default function AdminPayouts() {
  const [items, setItems] = useState<PayoutWithExpand[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<PayoutWithExpand>('payouts', {
      filter: status ? `status = "${status}"` : '',
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
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (p: PayoutWithExpand, next: string) => {
    try {
      await updateRecord('payouts', p.id, { status: next });
      adminAudit({ action: 'update', entity: 'payouts', entity_id: p.id, payload: { status: next } }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut actualitzar.');
    }
  };

  const sum = items.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Retirades</h1>
          <p className="admin-page-sub">
            {total} retirades · {fmtEuro(sum)} a la pàgina
          </p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setRecordOpen(true)}>
          Registrar pagament
        </button>
      </div>

      <AdminCard>
        <div className="admin-filters">
          <select
            className="admin-input"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            {TOTALS.map((s) => (
              <option key={s} value={s}>
                {s ? PAYOUT_STATUS[s] : 'Tots els estats'}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha retirades." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Import</th>
                  <th>Factura</th>
                  <th>Estat</th>
                  <th>Data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.expand?.partner ? (
                        <Link to={`/admin/partners/${p.expand.partner.id}`} className="admin-link">
                          {p.expand.partner.name}
                        </Link>
                      ) : (
                        p.partner
                      )}
                    </td>
                    <td>{fmtEuro(p.amount)}</td>
                    <td>{p.invoice_reference || '—'}</td>
                    <td>
                      <Badge tone={STATUS_TONE[p.status]}>{PAYOUT_STATUS[p.status] ?? p.status}</Badge>
                    </td>
                    <td>{fmtDate(p.created)}</td>
                    <td>
                      <select className="admin-input admin-input-sm" value={p.status} onChange={(e) => changeStatus(p, e.target.value)}>
                        {Object.entries(PAYOUT_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
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

      <RecordPayoutModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={() => {
          setRecordOpen(false);
          load();
        }}
      />
    </div>
  );
}

function RecordPayoutModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partner, setPartner] = useState('');
  const [amount, setAmount] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPartner('');
    setAmount('');
    setInvoiceRef('');
    listRecords<Partner>('partners', { sort: 'name', perPage: 200 })
      .then((res) => setPartners(res.items))
      .catch(() => setPartners([]));
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!partner) {
      setError('Selecciona un partner.');
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Import no vàlid.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminRecordPayout({ partner, amount: value, invoice_reference: invoiceRef.trim() || undefined });
      adminAudit({ action: 'create', entity: 'payouts', entity_id: partner, payload: { amount: value } }).catch(() => undefined);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut registrar el pagament.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Registrar pagament" onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Partner</span>
          <select className="admin-input" value={partner} onChange={(e) => setPartner(e.target.value)} required>
            <option value="">Selecciona…</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Import (€)</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span>Referència factura (opcional)</span>
            <input className="admin-input" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
          </label>
        </div>
        <p className="hint">
          Es descomptarà de la cartera del partner i se li notificarà per <strong>push i email</strong>.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Registrant…' : 'Registrar pagament'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
