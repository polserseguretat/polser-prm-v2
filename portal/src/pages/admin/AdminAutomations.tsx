import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  adminRunRule,
  adminAudit,
  ApiError,
  type NotificationRule,
} from '../../lib/adminApi';
import { AdminCard, Badge, Loading, ErrorBox, EmptyState, Modal } from '../../components/admin/ui';
import { AUDIENCE, CHANNEL, TRIGGER_TYPE, fmtEuro, fmtDateTime } from '../../lib/adminFormat';

const PER_PAGE = 100;

export default function AdminAutomations() {
  const [items, setItems] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<NotificationRule | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<NotificationRule>('notification_rules', { sort: 'name', perPage: PER_PAGE })
      .then((res) => setItems(res.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (r: NotificationRule) => {
    try {
      await updateRecord('notification_rules', r.id, { active: !r.active });
      adminAudit({ action: 'update', entity: 'notification_rules', entity_id: r.id, payload: { active: !r.active } }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut actualitzar l'estat.");
    }
  };

  const remove = async (r: NotificationRule) => {
    if (!confirm(`Esborrar la regla "${r.name}"? Aquesta acció no es pot desfer.`)) return;
    try {
      await deleteRecord('notification_rules', r.id);
      adminAudit({ action: 'delete', entity: 'notification_rules', entity_id: r.id }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut esborrar.");
    }
  };

  const runNow = async (r: NotificationRule) => {
    try {
      const res = await adminRunRule(r.id);
      setNotice(res.data.message);
      adminAudit({ action: 'run', entity: 'notification_rules', entity_id: r.id }).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut executar la regla.");
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Recordatoris</h1>
          <p className="admin-page-sub">Notificacions automàtiques (periòdiques o segons el saldo de la cartera)</p>
        </div>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => setCreateOpen(true)}>
          Nova regla
        </button>
      </div>

      {notice && (
        <div className="admin-notice">
          {notice}
          <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setNotice(null)}>
            Tanca
          </button>
        </div>
      )}

      <AdminCard>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState message="No hi ha cap regla. Crea'n una per començar." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Tipus</th>
                  <th>Condició</th>
                  <th>Públic</th>
                  <th>Canal</th>
                  <th>Darrera</th>
                  <th>Propera</th>
                  <th>Estat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <span className="admin-sub">{r.title}</span>
                    </td>
                    <td>{TRIGGER_TYPE[r.trigger_type] ?? r.trigger_type}</td>
                    <td>{conditionLabel(r)}</td>
                    <td>{AUDIENCE[r.audience] ?? r.audience}</td>
                    <td>{CHANNEL[r.channel] ?? r.channel}</td>
                    <td>{fmtDateTime(r.last_run_at)}</td>
                    <td>{r.trigger_type === 'periodic' ? fmtDateTime(r.next_run_at) : '—'}</td>
                    <td>
                      <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Activa' : 'Inactiva'}</Badge>
                    </td>
                    <td className="admin-row-actions">
                      {r.trigger_type === 'periodic' && (
                        <button type="button" className="admin-btn admin-btn-ghost" onClick={() => runNow(r)}>
                          Executa ara
                        </button>
                      )}
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setEditing(r)}>
                        Edita
                      </button>
                      <button type="button" className="admin-btn admin-btn-ghost" onClick={() => toggleActive(r)}>
                        {r.active ? 'Desactiva' : 'Activa'}
                      </button>
                      <button type="button" className="admin-btn admin-btn-danger" onClick={() => remove(r)}>
                        Esborra
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <RuleModal
        open={createOpen || editing !== null}
        rule={editing}
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

function conditionLabel(r: NotificationRule): string {
  if (r.trigger_type === 'periodic') {
    return `Cada ${r.interval_days ?? 14} dies`;
  }
  if (r.trigger_type === 'wallet_balance') {
    return `Saldo ≥ ${fmtEuro(r.min_balance ?? 0)} · màx. cada ${r.cooldown_days ?? 30} dies`;
  }
  return '—';
}

function RuleModal({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: NotificationRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    trigger_type: 'periodic',
    audience: 'all',
    channel: 'both',
    title: '',
    body: '',
    link: '',
    interval_days: '14',
    min_balance: '100',
    cooldown_days: '30',
    active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (rule) {
      setForm({
        name: rule.name ?? '',
        trigger_type: rule.trigger_type ?? 'periodic',
        audience: rule.audience ?? 'all',
        channel: rule.channel ?? 'both',
        title: rule.title ?? '',
        body: rule.body ?? '',
        link: rule.link ?? '',
        interval_days: rule.interval_days == null ? '14' : String(rule.interval_days),
        min_balance: rule.min_balance == null ? '100' : String(rule.min_balance),
        cooldown_days: rule.cooldown_days == null ? '30' : String(rule.cooldown_days),
        active: Boolean(rule.active),
      });
    } else {
      setForm({
        name: '',
        trigger_type: 'periodic',
        audience: 'all',
        channel: 'both',
        title: '',
        body: '',
        link: '',
        interval_days: '14',
        min_balance: '100',
        cooldown_days: '30',
        active: true,
      });
    }
  }, [open, rule]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.title.trim()) {
      setError('El nom i el títol són obligatoris.');
      return;
    }
    setError(null);
    setBusy(true);
    const num = (v: string, def: number) => {
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : def;
    };
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      trigger_type: form.trigger_type,
      audience: form.audience,
      channel: form.channel,
      title: form.title.trim(),
      body: form.body.trim(),
      link: form.link.trim(),
      active: form.active,
      interval_days: form.trigger_type === 'periodic' ? num(form.interval_days, 14) : 14,
      min_balance: form.trigger_type === 'wallet_balance' ? num(form.min_balance, 100) : 100,
      cooldown_days: form.trigger_type === 'wallet_balance' ? num(form.cooldown_days, 30) : 30,
    };
    try {
      if (rule) {
        await updateRecord<NotificationRule>('notification_rules', rule.id, body);
        adminAudit({ action: 'update', entity: 'notification_rules', entity_id: rule.id }).catch(() => undefined);
      } else {
        const created = await createRecord<NotificationRule>('notification_rules', body);
        adminAudit({ action: 'create', entity: 'notification_rules', entity_id: created.id }).catch(() => undefined);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No s'ha pogut desar la regla.");
    } finally {
      setBusy(false);
    }
  };

  const isPeriodic = form.trigger_type === 'periodic';
  const isWallet = form.trigger_type === 'wallet_balance';

  return (
    <Modal open={open} title={rule ? `Edita «${rule.name}»` : 'Nova regla'} onClose={onClose} wide>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form-grid">
          <label className="admin-field">
            <span>Nom intern</span>
            <input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="admin-field">
            <span>Tipus</span>
            <select className="admin-input" value={form.trigger_type} onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}>
              {Object.entries(TRIGGER_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Públic</span>
            <select className="admin-input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {Object.entries(AUDIENCE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Canal</span>
            <select className="admin-input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {Object.entries(CHANNEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          {isPeriodic && (
            <label className="admin-field">
              <span>Interval (dies)</span>
              <input className="admin-input" type="number" min={1} value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} />
            </label>
          )}
          {isWallet && (
            <>
              <label className="admin-field">
                <span>Saldo mínim (€)</span>
                <input className="admin-input" type="number" min={0} step="0.01" value={form.min_balance} onChange={(e) => setForm({ ...form, min_balance: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>No repetir abans de (dies)</span>
                <input className="admin-input" type="number" min={1} value={form.cooldown_days} onChange={(e) => setForm({ ...form, cooldown_days: e.target.value })} />
              </label>
            </>
          )}
        </div>

        <p className="hint">
          {isPeriodic
            ? "S'envia automàticament cada interval. La primera vegada, al proper cicle (≤15 min)."
            : 'S\'envia als partners amb saldo disponible ≥ el mínim, com a màxim un cop per cooldown.'}
        </p>

        <label className="admin-field">
          <span>Títol</span>
          <input className="admin-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </label>
        <label className="admin-field">
          <span>Missatge</span>
          <textarea className="admin-input" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <label className="admin-field">
          <span>Enllaç (opcional, dins l'app)</span>
          <input className="admin-input" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="/referrals · /wallet · /" />
        </label>

        <label className="admin-checkbox">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Activa
        </label>

        {error && <p className="error">{error}</p>}
        <div className="admin-actions">
          <button type="button" className="admin-btn admin-btn-ghost" onClick={onClose}>
            Cancel·la
          </button>
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Desant…' : rule ? 'Desa els canvis' : 'Crea la regla'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
