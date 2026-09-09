import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createReferral, getServices, ApiError, type ReferralPayload, type Service } from '../lib/api';

const FALLBACK_SERVICES: Service[] = [
  { id: 'demo-alarma', code: 'pis', name: 'Alarma per a la llar', category: 'alarma', sector: 'residencial', alta_fee: 599, monthly_fee: 27.99, iva_included: true, details: null, active: true },
  { id: 'demo-cctv', code: 'videovigilancia', name: 'Videovigilància', category: 'videovigilancia', sector: 'residencial', alta_fee: 320, monthly_fee: 12, iva_included: true, details: null, active: true },
];

export default function ReferralNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const suggested = (location.state as { product?: string } | null)?.product;

  const [services, setServices] = useState<Service[]>(FALLBACK_SERVICES);
  const [form, setForm] = useState<ReferralPayload>({
    client_name: '',
    client_phone: '',
    client_email: '',
    client_address: '',
    service: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getServices()
      .then((res) => {
        if (!active || !res.data) return;
        setServices(res.data);
        // Pre-selecciona el servei suggerit (des del dashboard)
        const suggestedService = res.data.find((s) => s.name === suggested);
        if (suggestedService) setForm((f) => ({ ...f, service: suggestedService.id }));
      })
      .catch(() => {
        // fallback a demo
      });
    return () => {
      active = false;
    };
  }, [suggested]);

  const set = (key: keyof ReferralPayload, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.client_name.trim()) {
      setError('Introduïu el nom del client.');
      return;
    }
    if (!form.service) {
      setError('Seleccioneu un producte o servei.');
      return;
    }

    setLoading(true);
    try {
      await createReferral(form);
      navigate('/referrals', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No s\'ha pogut crear el referit. Torneu-ho a provar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-inner">
      <h1 className="page-title">Nou referit</h1>
      <p className="page-sub">Envieu una referència d\'un client potencial.</p>

      <form onSubmit={submit} className="form form-card">
        <label className="field">
          <span>Nom del client</span>
          <input
            value={form.client_name}
            onChange={(e) => set('client_name', e.target.value)}
            placeholder="Nom i cognoms"
          />
        </label>

        <label className="field">
          <span>Telèfon</span>
          <input
            type="tel"
            value={form.client_phone}
            onChange={(e) => set('client_phone', e.target.value)}
            placeholder="600 000 000"
          />
        </label>

        <label className="field">
          <span>Correu electrònic</span>
          <input
            type="email"
            value={form.client_email}
            onChange={(e) => set('client_email', e.target.value)}
            placeholder="client@exemple.cat"
          />
        </label>

        <label className="field">
          <span>Adreça (opcional)</span>
          <input
            value={form.client_address}
            onChange={(e) => set('client_address', e.target.value)}
            placeholder="Carrer i ciutat"
          />
        </label>

        <label className="field">
          <span>Producte / servei</span>
          <select value={form.service} onChange={(e) => set('service', e.target.value)}>
            <option value="">Seleccioneu…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Comentaris (opcional)</span>
          <textarea
            rows={3}
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Notes internes per al referit."
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
            Cancel·lar
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Enviant…' : 'Envia el referit'}
          </button>
        </div>
      </form>
    </div>
  );
}