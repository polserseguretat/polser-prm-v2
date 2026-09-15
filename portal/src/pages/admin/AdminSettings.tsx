import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listRecords, updateRecord, adminAudit, ApiError, type Settings } from '../../lib/adminApi';
import { AdminCard, Loading, ErrorBox, EmptyState } from '../../components/admin/ui';

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    min_payout: '0',
    payout_days: '0',
    default_fixed_commission: '0',
    default_recurring_rate: '0',
    recurring_enabled: false,
    invoice_concept: '',
    sla_days_no_contact: '0',
    sign_config: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listRecords<Settings>('settings', { perPage: 1 })
      .then((res) => {
        const s = res.items[0] ?? null;
        setSettings(s);
        if (s) {
          setForm({
            min_payout: String(s.min_payout ?? 0),
            payout_days: String(s.payout_days ?? 0),
            default_fixed_commission: String(s.default_fixed_commission ?? 0),
            default_recurring_rate: String(s.default_recurring_rate ?? 0),
            recurring_enabled: Boolean(s.recurring_enabled),
            invoice_concept: s.invoice_concept ?? '',
            sla_days_no_contact: String(s.sla_days_no_contact ?? 0),
            sign_config: s.sign_config ? JSON.stringify(s.sign_config, null, 2) : '',
          });
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    let signConfig: unknown = undefined;
    if (form.sign_config.trim()) {
      try {
        signConfig = JSON.parse(form.sign_config);
      } catch {
        setError('El JSON de sign_config no és vàlid.');
        setSaving(false);
        return;
      }
    }

    try {
      const body: Record<string, unknown> = {
        min_payout: Number(form.min_payout),
        payout_days: Number(form.payout_days),
        default_fixed_commission: Number(form.default_fixed_commission),
        default_recurring_rate: Number(form.default_recurring_rate),
        recurring_enabled: form.recurring_enabled,
        invoice_concept: form.invoice_concept,
        sla_days_no_contact: Number(form.sla_days_no_contact),
      };
      if (signConfig !== undefined) body.sign_config = signConfig;
      const updated = await updateRecord<Settings>('settings', settings.id, body);
      setSettings(updated);
      setNotice('Ajustos desats.');
      adminAudit({ action: 'update', entity: 'settings', entity_id: settings.id }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'han pogut desar els ajustos.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (error && !settings) return <ErrorBox message={error} onRetry={load} />;
  if (!settings) return <EmptyState message="No hi ha cap fila de configuració." />;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Ajustos globals</h1>
          <p className="admin-page-sub">Paràmetres de negoci del PRM</p>
        </div>
      </div>

      {notice && <p className="admin-ok">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <AdminCard title="Paràmetres">
        <form className="admin-form" onSubmit={save}>
          <div className="admin-form-grid">
            <label className="admin-field">
              <span>Retirada mínima (€)</span>
              <input className="admin-input" type="number" step="0.01" value={form.min_payout} onChange={(e) => setForm({ ...form, min_payout: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Dies de pagament</span>
              <input className="admin-input" type="number" value={form.payout_days} onChange={(e) => setForm({ ...form, payout_days: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Comissió fixa per defecte (€)</span>
              <input className="admin-input" type="number" step="0.01" value={form.default_fixed_commission} onChange={(e) => setForm({ ...form, default_fixed_commission: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Taxa recurrent per defecte (0–1)</span>
              <input className="admin-input" type="number" step="0.001" value={form.default_recurring_rate} onChange={(e) => setForm({ ...form, default_recurring_rate: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>SLA sense contacte (dies)</span>
              <input className="admin-input" type="number" value={form.sla_days_no_contact} onChange={(e) => setForm({ ...form, sla_days_no_contact: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Concepte de factura</span>
              <input className="admin-input" value={form.invoice_concept} onChange={(e) => setForm({ ...form, invoice_concept: e.target.value })} />
            </label>
          </div>

          <label className="admin-checkbox">
            <input type="checkbox" checked={form.recurring_enabled} onChange={(e) => setForm({ ...form, recurring_enabled: e.target.checked })} />
            Comissió recurrent activada
          </label>

          <label className="admin-field">
            <span>Configuració de signatura (JSON)</span>
            <textarea
              className="admin-input admin-code"
              rows={14}
              value={form.sign_config}
              onChange={(e) => setForm({ ...form, sign_config: e.target.value })}
              spellCheck={false}
            />
          </label>

          <div className="admin-actions">
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
              {saving ? 'Desant…' : 'Desa els ajustos'}
            </button>
          </div>
        </form>
      </AdminCard>
    </div>
  );
}
