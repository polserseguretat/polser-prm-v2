import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getRecord,
  listRecords,
  updateRecord,
  adminInvitePartner,
  adminAudit,
  ApiError,
  type Partner,
  type PartnerUser,
  type PartnerMember,
  type Referral,
  type WalletEntry,
} from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState } from '../../components/admin/ui';
import {
  PARTNER_STATUS,
  PARTNER_STATUS_TONE,
  PROFILE_LABEL,
  PARTNER_TYPE,
  CONTRACT_STATUS,
  REFERRAL_STATUS,
  LEDGER_TYPE,
  fmtDate,
  fmtEuro,
} from '../../lib/adminFormat';

export default function AdminPartnerDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [members, setMembers] = useState<PartnerMember[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [ledger, setLedger] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    nif: '',
    phone: '',
    address: '',
    status: 'pendente',
    profile: 'afiliat',
    type: 'otro',
    notes: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getRecord<Partner>('partners', id),
      listRecords<PartnerUser>('partner_users', { filter: `partner = "${id}"`, perPage: 100 }),
      listRecords<PartnerMember>('partner_members', { filter: `partner = "${id}"`, perPage: 100 }),
      listRecords<Referral>('referrals', { filter: `partner = "${id}"`, sort: '-created_at', perPage: 100 }),
      listRecords<WalletEntry>('wallet_ledger', { filter: `partner = "${id}"`, sort: '-created_at', perPage: 100 }),
    ])
      .then(([p, u, m, r, w]) => {
        setPartner(p);
        setUsers(u.items);
        setMembers(m.items);
        setReferrals(r.items);
        setLedger(w.items);
        setForm({
          name: p.name || '',
          email: p.email || '',
          nif: p.nif || '',
          phone: p.phone || '',
          address: p.address || '',
          status: p.status || 'pendente',
          profile: p.profile || 'afiliat',
          type: p.type || 'otro',
          notes: p.notes || '',
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await updateRecord<Partner>('partners', id, {
        name: form.name,
        email: form.email || null,
        nif: form.nif || null,
        phone: form.phone || null,
        address: form.address || null,
        status: form.status,
        profile: form.profile,
        type: form.type,
        notes: form.notes || null,
      });
      setPartner(updated);
      setNotice('Canvis desats.');
      adminAudit({ action: 'update', entity: 'partners', entity_id: id }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut desar.');
    } finally {
      setSaving(false);
    }
  };

  const promote = async () => {
    if (!confirm('Ascendir aquest partner a Col·laborador? Tindrà dret a comissió recurrent.')) return;
    try {
      const updated = await updateRecord<Partner>('partners', id, { profile: 'colaborador' });
      setPartner(updated);
      setForm((f) => ({ ...f, profile: 'colaborador' }));
      setNotice('Partner ascendit a col·laborador.');
      adminAudit({ action: 'update', entity: 'partners', entity_id: id, payload: { profile: 'colaborador' } }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut ascendir.');
    }
  };

  const resendInvite = async () => {
    setNotice(null);
    setError(null);
    setInviteUrl(null);
    try {
      const res = await adminInvitePartner({ name: form.name, email: form.email });
      setInviteUrl(res.data.invite_url);
      setNotice(res.data.mail_sent ? 'Invitació reenviada per correu.' : 'Invitació regenerada (correu no enviat).');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut reenviar la invitació.');
    }
  };

  if (loading) return <Loading />;
  if (error && !partner) return <ErrorBox message={error} onRetry={load} />;
  if (!partner) return <EmptyState message="Partner no trobat." />;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-breadcrumb">
            <Link to="/admin/partners">Partners</Link> / {partner.name}
          </p>
          <h1 className="admin-page-title">{partner.name}</h1>
        </div>
        {partner.profile !== 'colaborador' && partner.type !== 'autonomo' && (
          <button type="button" className="admin-btn" onClick={promote}>
            Ascendeix a col·laborador
          </button>
        )}
      </div>

      {notice && <p className="admin-ok">{notice}</p>}
      {inviteUrl && <input className="admin-input" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />}
      {error && <p className="error">{error}</p>}

      <div className="admin-grid-2">
        <AdminCard title="Fitxa">
          <form className="admin-form" onSubmit={save}>
            <div className="admin-form-grid">
              <label className="admin-field">
                <span>Nom</span>
                <input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>Correu</span>
                <input className="admin-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>NIF</span>
                <input className="admin-input" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>Telèfon</span>
                <input className="admin-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>Estat</span>
                <select className="admin-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(PARTNER_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Perfil</span>
                <select className="admin-input" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                  <option value="afiliat">Afiliat</option>
                  <option value="colaborador">Col·laborador</option>
                </select>
              </label>
              <label className="admin-field">
                <span>Tipus</span>
                <select className="admin-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {Object.entries(PARTNER_TYPE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field admin-field-full">
                <span>Adreça</span>
                <input className="admin-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label className="admin-field admin-field-full">
                <span>Notes</span>
                <textarea className="admin-input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>
            <div className="admin-actions">
              <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
                {saving ? 'Desant…' : 'Desa'}
              </button>
            </div>
          </form>
        </AdminCard>

        <div className="admin-stack">
          <AdminCard title="Estat intern">
            <dl className="admin-dl">
              <div>
                <dt>Contracte</dt>
                <dd>{CONTRACT_STATUS[partner.contract_status] ?? partner.contract_status}</dd>
              </div>
              <div>
                <dt>Alta</dt>
                <dd>{fmtDate(partner.activation_date || partner.created)}</dd>
              </div>
              <div>
                <dt>Invitació caduca</dt>
                <dd>{fmtDate(partner.invite_expires_at)}</dd>
              </div>
              <div>
                <dt>Odoo partner</dt>
                <dd>{partner.odo_partner_id ?? '—'}</dd>
              </div>
            </dl>
            {partner.status === 'pendente' && (
              <button type="button" className="admin-btn admin-btn-ghost" onClick={resendInvite}>
                Reenviar invitació
              </button>
            )}
          </AdminCard>

          <AdminCard title={`Usuaris (${users.length})`}>
            {users.length === 0 ? (
              <EmptyState message="Sense usuaris del portal." />
            ) : (
              <ul className="admin-list">
                {users.map((u) => (
                  <li key={u.id}>
                    <span>{u.email}</span>
                    <Badge tone={u.disabled ? 'red' : 'gray'}>{u.disabled ? 'Desactivat' : 'Actiu'}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {members.length > 0 && (
              <p className="admin-sub">{members.length} vinculacions a partner_members.</p>
            )}
          </AdminCard>
        </div>
      </div>

      <AdminCard title={`Referits (${referrals.length})`}>
        {referrals.length === 0 ? (
          <EmptyState message="Sense referits." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Codi</th>
                  <th>Client</th>
                  <th>Estat</th>
                  <th>Comissió alta</th>
                  <th>Recurrent</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td>{r.referral_code ?? '—'}</td>
                    <td>{r.client_name ?? '—'}</td>
                    <td>{REFERRAL_STATUS[r.status] ?? r.status}</td>
                    <td>{fmtEuro(r.partner_commission_alta)}</td>
                    <td>{fmtEuro(r.partner_commission_recurrente)}</td>
                    <td>{fmtDate(r.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminCard title={`Cartera (${ledger.length})`}>
        {ledger.length === 0 ? (
          <EmptyState message="Sense moviments." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tipus</th>
                  <th>Import</th>
                  <th>Període</th>
                  <th>Descripció</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((w) => (
                  <tr key={w.id}>
                    <td>{LEDGER_TYPE[w.type] ?? w.type}</td>
                    <td>{fmtEuro(w.amount)}</td>
                    <td>{w.period ?? '—'}</td>
                    <td>{w.description ?? '—'}</td>
                    <td>{fmtDate(w.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <p>
        <Badge tone={PARTNER_STATUS_TONE[partner.status]}>{PARTNER_STATUS[partner.status] ?? partner.status}</Badge>{' '}
        <span className="admin-sub">{PROFILE_LABEL[partner.profile] ?? partner.profile}</span>
      </p>
    </div>
  );
}
