import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { listRecords, adminBackfillReferral, adminAudit, ApiError, type Referral, type ReferralEvent, type Partner, type Service } from '../../lib/adminApi';
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
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setBackfillOpen(true)}>
          Afegir referit històric
        </button>
      </div>

      {notice && <p className="admin-ok">{notice}</p>}

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

      <BackfillModal
        open={backfillOpen}
        onClose={() => setBackfillOpen(false)}
        onSaved={(msg) => {
          setBackfillOpen(false);
          setNotice(msg);
          load();
        }}
      />
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

/* -------------------------------------------------------------------
 * Backfill d'un referit històric (PRM-only): crea el referit en estat
 * instal·lat i genera les comissions (alta + recurrent mensual) fins avui.
 * ------------------------------------------------------------------- */

function monthRange(startDate: string, includeInstall: boolean): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return [];
  let y = parseInt(startDate.slice(0, 4), 10);
  let m = parseInt(startDate.slice(5, 7), 10);
  if (!includeInstall) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const now = new Date();
  const ny = now.getFullYear();
  const nm = now.getMonth() + 1;
  const out: string[] = [];
  while (y < ny || (y === ny && m <= nm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

function BackfillModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [partner, setPartner] = useState('');
  const [client, setClient] = useState('');
  const [stageDate, setStageDate] = useState(new Date().toISOString().slice(0, 10));
  const [commAlta, setCommAlta] = useState('');
  const [commRec, setCommRec] = useState('');
  const [service, setService] = useState('');
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [odoOpp, setOdoOpp] = useState('');
  const [includeMonth, setIncludeMonth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPartner('');
    setClient('');
    setStageDate(new Date().toISOString().slice(0, 10));
    setCommAlta('');
    setCommRec('');
    setService('');
    setCode('');
    setNotes('');
    setOdoOpp('');
    setIncludeMonth(true);
    Promise.allSettled([
      listRecords<Partner>('partners', { sort: 'name', perPage: 200 }),
      listRecords<Service>('services', { sort: 'name', perPage: 200 }),
    ]).then(([p, s]) => {
      setPartners(p.status === 'fulfilled' ? p.value.items : []);
      setServices(s.status === 'fulfilled' ? s.value.items : []);
    });
  }, [open]);

  const partnerObj = partners.find((x) => x.id === partner);
  const isAfiliat = partnerObj?.profile === 'afiliat';

  const periods = useMemo(() => monthRange(stageDate, includeMonth), [stageDate, includeMonth]);
  const alta = Number(commAlta.replace(',', '.')) || 0;
  const rec = isAfiliat ? 0 : Number(commRec.replace(',', '.')) || 0;
  const total = alta + rec * periods.length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!partner) {
      setError('Selecciona un partner.');
      return;
    }
    if (!client.trim()) {
      setError('Cal indicar el nom del client.');
      return;
    }
    if (!(alta > 0)) {
      setError("L'import de comissió d'alta ha de ser més gran que 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opp = Number(odoOpp);
      const res = await adminBackfillReferral({
        partner,
        client_name: client.trim(),
        stage_date: stageDate,
        commission_alta: alta,
        commission_recurring: rec,
        service: service || undefined,
        referral_code: code.trim() || undefined,
        notes: notes.trim() || undefined,
        include_install_month: includeMonth,
        odo_opportunity_id: opp > 0 ? Math.trunc(opp) : undefined,
      });
      adminAudit({
        action: 'create',
        entity: 'referrals',
        entity_id: res.data.referral_id,
        payload: { backfill: true, total: res.data.total },
      }).catch(() => undefined);
      onSaved(
        `Referit ${res.data.referral_code} creat · alta + ${res.data.recurring_created} recurrents · total ${fmtEuro(res.data.total)}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut crear el referit històric.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Afegir referit històric" onClose={onClose} wide>
      <form className="admin-form" onSubmit={submit}>
        <p className="hint">
          Importa un referit ja tancat (instal·lat). Es crea <strong>només al PRM</strong> (no es crea cap
          oportunitat nova a Odoo) i s'hi afegeixen la comissió d'alta i les recurrents fins al mes actual.
          Si hi poses l'<strong>ID d'una oportunitat d'Odoo</strong>, el referit es vincula a la que ja
          existeix. A partir d'ara el sistema continua amb el cicle normal.
        </p>

        <div className="admin-form-grid">
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
          <label className="admin-field">
            <span>Client</span>
            <input className="admin-input" value={client} onChange={(e) => setClient(e.target.value)} required />
          </label>
          <label className="admin-field">
            <span>Data d'alta (instal·lació)</span>
            <input
              className="admin-input"
              type="date"
              value={stageDate}
              onChange={(e) => setStageDate(e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span>Servei (opcional)</span>
            <select className="admin-input" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Comissió d'alta (€)</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step="0.01"
              value={commAlta}
              onChange={(e) => setCommAlta(e.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span>Comissió recurrent mensual (€)</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              step="0.01"
              value={isAfiliat ? '0' : commRec}
              onChange={(e) => setCommRec(e.target.value)}
              disabled={isAfiliat}
            />
          </label>
          <label className="admin-field">
            <span>Codi (opcional)</span>
            <input
              className="admin-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="REF-XXXXXX"
            />
          </label>
          <label className="admin-field">
            <span>ID oportunitat Odoo (opcional)</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              value={odoOpp}
              onChange={(e) => setOdoOpp(e.target.value)}
              placeholder="crm.lead id"
            />
          </label>
        </div>

        {isAfiliat && (
          <p className="hint">
            Aquest partner és <strong>afiliat</strong>: per la regla CEO només rep comissió d'alta (mai
            recurrent).
          </p>
        )}

        <label className="admin-checkbox">
          <input type="checkbox" checked={includeMonth} onChange={(e) => setIncludeMonth(e.target.checked)} />
          Inclou el mes d'alta a la recurrent
        </label>

        <p className="hint">
          S'afegirà <strong>1</strong> comissió d'alta
          {rec > 0 && periods.length > 0 ? (
            <>
              {' '}
              i <strong>{periods.length}</strong> recurrents ({periods[0]} → {periods[periods.length - 1]})
            </>
          ) : null}
          .<br />
          Total a la cartera: <strong>{fmtEuro(total)}</strong>.
        </p>

        <label className="admin-field">
          <span>Notes (opcional)</span>
          <textarea className="admin-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Creant…' : 'Crear referit històric'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
