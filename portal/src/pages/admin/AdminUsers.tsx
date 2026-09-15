import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  listRecords,
  updateRecord,
  deleteRecord,
  adminCreateUser,
  adminAudit,
  ApiError,
  type PartnerUser,
  type Partner,
} from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { USER_ROLE } from '../../lib/adminFormat';

type UserWithExpand = PartnerUser & { expand?: { partner?: Partner } };

const PER_PAGE = 50;

export default function AdminUsers() {
  const [items, setItems] = useState<UserWithExpand[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const parts: string[] = [];
    if (search.trim()) {
      const q = search.trim().replace(/"/g, '\\"');
      parts.push(`(email ~ "${q}" || name ~ "${q}")`);
    }
    listRecords<UserWithExpand>('partner_users', {
      filter: parts.join(' && '),
      sort: '-created',
      page,
      perPage: PER_PAGE,
      expand: 'partner',
    })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
        setTotal(res.totalItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeRole = async (u: UserWithExpand, role: string) => {
    try {
      await updateRecord('partner_users', u.id, { role });
      adminAudit({ action: 'update', entity: 'partner_users', entity_id: u.id, payload: { role } }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut canviar el rol.');
    }
  };

  const toggleDisabled = async (u: UserWithExpand) => {
    try {
      await updateRecord('partner_users', u.id, { disabled: !u.disabled });
      adminAudit({ action: 'update', entity: 'partner_users', entity_id: u.id, payload: { disabled: !u.disabled } }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut actualitzar l\'estat.');
    }
  };

  const remove = async (u: UserWithExpand) => {
    if (!confirm(`Esborrar l'usuari ${u.email}? Aquesta acció no es pot desfer.`)) return;
    try {
      await deleteRecord('partner_users', u.id);
      adminAudit({ action: 'delete', entity: 'partner_users', entity_id: u.id }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut esborrar.');
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Usuaris del portal</h1>
          <p className="admin-page-sub">{total} comptes</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setCreateOpen(true)}>
          Nou usuari
        </button>
      </div>

      <AdminCard>
        <div className="admin-filters">
          <input
            className="admin-input"
            placeholder="Cerca per correu o nom…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha usuaris." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Correu</th>
                  <th>Nom</th>
                  <th>Rol</th>
                  <th>Partner</th>
                  <th>Estat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.name || '—'}</td>
                    <td>
                      <select className="admin-input admin-input-sm" value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                        {Object.entries(USER_ROLE).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{u.expand?.partner?.name || '—'}</td>
                    <td>
                      <Badge tone={u.disabled ? 'red' : 'green'}>{u.disabled ? 'Desactivat' : 'Actiu'}</Badge>
                    </td>
                    <td className="admin-row-actions">
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => toggleDisabled(u)}>
                        {u.disabled ? 'Activa' : 'Desactiva'}
                      </button>
                      <button type="button" className="admin-btn admin-btn-danger" onClick={() => remove(u)}>
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

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('partner');
  const [partnerId, setPartnerId] = useState('');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listRecords<Partner>('partners', { sort: 'name', perPage: 200 })
      .then((res) => setPartners(res.items))
      .catch(() => setPartners([]));
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminCreateUser({ email: email.trim(), name: name.trim(), role, partner: partnerId || undefined });
      setEmail('');
      setName('');
      setRole('partner');
      setPartnerId('');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut crear l\'usuari.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Nou usuari del portal" onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Correu electrònic</span>
          <input className="admin-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Nom</span>
          <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>Rol</span>
          <select className="admin-input" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(USER_ROLE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {role === 'partner' && (
          <label className="admin-field">
            <span>Partner</span>
            <select className="admin-input" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">— Sense partner —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="hint">L'accés és per OTP (6 dígits al correu). No cal contrasenya.</p>
        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Creant…' : 'Crea'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
