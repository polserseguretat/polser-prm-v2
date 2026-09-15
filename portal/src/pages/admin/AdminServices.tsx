import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listRecords, createRecord, updateRecord, deleteRecord, adminAudit, ApiError, type Service } from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { fmtEuro, fmtDate } from '../../lib/adminFormat';

const CATEGORY: Record<string, string> = {
  alarma: 'Alarma',
  videovigilancia: 'Videovigilància',
  manteniment: 'Manteniment',
};

const SECTOR: Record<string, string> = {
  residencial: 'Residencial',
  negocio: 'Negoci',
  comunidades: 'Comunitats',
  industria: 'Indústria',
};

const PER_PAGE = 50;

export default function AdminServices() {
  const [items, setItems] = useState<Service[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const parts: string[] = [];
    if (search.trim()) {
      const q = search.trim().replace(/"/g, '\\"');
      parts.push(`(code ~ "${q}" || name ~ "${q}")`);
    }
    if (activeFilter) parts.push(`active = ${activeFilter}`);
    listRecords<Service>('services', {
      filter: parts.join(' && '),
      sort: 'name',
      page,
      perPage: PER_PAGE,
    })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.totalItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [search, activeFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (s: Service) => {
    try {
      await updateRecord('services', s.id, { active: !s.active });
      adminAudit({ action: 'update', entity: 'services', entity_id: s.id, payload: { active: !s.active } }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut actualitzar l\'estat.');
    }
  };

  const remove = async (s: Service) => {
    if (!confirm(`Esborrar el servei "${s.name}"? Aquesta acció no es pot desfer.`)) return;
    try {
      await deleteRecord('services', s.id);
      adminAudit({ action: 'delete', entity: 'services', entity_id: s.id }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut esborrar (pot estar en ús).');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Serveis</h1>
          <p className="admin-page-sub">{total} serveis al catàleg</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setCreateOpen(true)}>
          Nou servei
        </button>
      </div>

      <AdminCard>
        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="Cerca per codi o nom…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <select
            className="admin-input"
            value={activeFilter}
            onChange={(e) => {
              setPage(1);
              setActiveFilter(e.target.value);
            }}
          >
            <option value="">Tots</option>
            <option value="true">Actius</option>
            <option value="false">Inactius</option>
          </select>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha serveis que coincideixin." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Codi</th>
                  <th>Nom</th>
                  <th>Categoria</th>
                  <th>Sector</th>
                  <th>Alta</th>
                  <th>Quota/mes</th>
                  <th>IVA</th>
                  <th>Estat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.code}</td>
                    <td>
                      <strong>{s.name}</strong>
                      <span className="admin-sub">{fmtDate(s.created)}</span>
                    </td>
                    <td>{CATEGORY[s.category] ?? s.category}</td>
                    <td>{SECTOR[s.sector] ?? s.sector}</td>
                    <td>{priceLabel(s.alta_fee)}</td>
                    <td>{priceLabel(s.monthly_fee)}</td>
                    <td>{s.iva_included ? 'Inclòs' : 'No inclòs'}</td>
                    <td>
                      <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'Actiu' : 'Inactiu'}</Badge>
                    </td>
                    <td className="admin-row-actions">
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setEditing(s)}>
                        Edita
                      </button>
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => toggleActive(s)}>
                        {s.active ? 'Desactiva' : 'Activa'}
                      </button>
                      <button type="button" className="admin-btn admin-btn-danger" onClick={() => remove(s)}>
                        Esborra
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

      <ServiceModal
        open={createOpen || editing !== null}
        service={editing}
        onClose={() => {
          setCreateOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreateOpen(false);
          setEditing(null);
          load();
        }}
      />
    </div>
  );
}

function priceLabel(value: number | null): string {
  if (value === null || value === undefined) return 'A mida';
  if (value === 0) return 'Gratuït';
  if (value < 0) return 'A mida';
  return fmtEuro(value);
}

function ServiceModal({
  open,
  service,
  onClose,
  onSaved,
}: {
  open: boolean;
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'alarma',
    sector: 'residencial',
    alta_fee: '',
    monthly_fee: '',
    iva_included: false,
    active: true,
    description: '',
    image: '',
    details: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (service) {
      setForm({
        code: service.code ?? '',
        name: service.name ?? '',
        category: service.category ?? 'alarma',
        sector: service.sector ?? 'residencial',
        alta_fee: service.alta_fee == null ? '' : String(service.alta_fee),
        monthly_fee: service.monthly_fee == null ? '' : String(service.monthly_fee),
        iva_included: Boolean(service.iva_included),
        active: Boolean(service.active),
        description: service.presentation?.description ?? '',
        image: service.presentation?.image ?? '',
        details: service.details ? JSON.stringify(service.details, null, 2) : '',
      });
    } else {
      setForm({
        code: '',
        name: '',
        category: 'alarma',
        sector: 'residencial',
        alta_fee: '',
        monthly_fee: '',
        iva_included: false,
        active: true,
        description: '',
        image: '',
        details: '',
      });
    }
  }, [open, service]);

  const parsePrice = (raw: string): number => {
    const t = raw.trim();
    if (t === '') return -1; // pressupost a mida
    const n = Number(t);
    return Number.isFinite(n) ? n : -1;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setError('El codi i el nom són obligatoris.');
      return;
    }
    setError(null);

    let details: unknown = undefined;
    if (form.details.trim()) {
      try {
        details = JSON.parse(form.details);
      } catch {
        setError('Els detalls (JSON) no són vàlids.');
        return;
      }
    }

    const presentation: Record<string, unknown> = {};
    if (form.description.trim()) presentation.description = form.description.trim();
    if (form.image.trim()) presentation.image = form.image.trim();

    const body: Record<string, unknown> = {
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      sector: form.sector,
      alta_fee: parsePrice(form.alta_fee),
      monthly_fee: parsePrice(form.monthly_fee),
      iva_included: form.iva_included,
      active: form.active,
      presentation,
    };
    if (details !== undefined) body.details = details;

    setBusy(true);
    try {
      if (service) {
        await updateRecord<Service>('services', service.id, body);
        adminAudit({ action: 'update', entity: 'services', entity_id: service.id }).catch(() => undefined);
      } else {
        const created = await createRecord<Service>('services', body);
        adminAudit({ action: 'create', entity: 'services', entity_id: created.id }).catch(() => undefined);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut desar el servei.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={service ? `Edita «${service.code}»` : 'Nou servei'} onClose={onClose} wide>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Codi</span>
            <input className="admin-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </label>
          <label className="admin-field">
            <span>Nom</span>
            <input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="admin-field">
            <span>Categoria</span>
            <select className="admin-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Sector</span>
            <select className="admin-input" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}>
              {Object.entries(SECTOR).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Alta (€)</span>
            <input className="admin-input" type="number" step="0.01" value={form.alta_fee} onChange={(e) => setForm({ ...form, alta_fee: e.target.value })} />
          </label>
          <label className="admin-field">
            <span>Quota mensual (€)</span>
            <input className="admin-input" type="number" step="0.01" value={form.monthly_fee} onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })} />
          </label>
        </div>

        <p className="hint">
          Imports en euros: <strong>buit</strong> = pressupost a mida (&minus;1), <strong>0</strong> = gratuït,
          &gt;0 = preu fix.
        </p>

        <div className="admin-form-grid">
          <label className="admin-checkbox">
            <input type="checkbox" checked={form.iva_included} onChange={(e) => setForm({ ...form, iva_included: e.target.checked })} /> IVA inclòs
          </label>
          <label className="admin-checkbox">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Actiu (visible al portal)
          </label>
        </div>

        <label className="admin-field">
          <span>Descripció (presentació)</span>
          <textarea className="admin-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <label className="admin-field">
          <span>Imatge (URL)</span>
          <input className="admin-input" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://…" />
        </label>
        <label className="admin-field">
          <span>Detalls (JSON, opcional)</span>
          <textarea className="admin-input admin-code" rows={4} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} spellCheck={false} />
        </label>

        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Desant…' : service ? 'Desa els canvis' : 'Crea el servei'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
