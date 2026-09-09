import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createReferral, getServices, ApiError, type Service } from '../lib/api';
import { SparklesIcon, BuildingIcon, CommunityIcon, FactoryIcon, CheckIcon } from '../components/Icons';

const FALLBACK_SERVICES: Service[] = [
  { id: 'demo-alarma', code: 'pis', name: 'Per pisos', category: 'alarma', sector: 'residencial', alta_fee: 599, monthly_fee: 27.99, iva_included: true, details: null, active: true },
  { id: 'demo-cctv', code: 'casa', name: 'Per cases', category: 'alarma', sector: 'residencial', alta_fee: 749, monthly_fee: 29.99, iva_included: true, details: null, active: true },
  { id: 'demo-oficina', code: 'oficina', name: 'Per oficines', category: 'alarma', sector: 'negocio', alta_fee: 549, monthly_fee: 27.99, iva_included: false, details: null, active: true },
];

const SECTOR_STEPS = [
  {
    value: 'residencial',
    title: 'Per a la seva llar',
    icon: 'casa',
    desc: 'Pisos i cases particulars',
  },
  {
    value: 'negocio',
    title: 'Per al seu negoci',
    icon: 'negoci',
    desc: 'Oficines, botigues i locals',
  },
  {
    value: 'comunidades',
    title: 'Per a la seva comunitat',
    icon: 'comunitat',
    desc: 'Comunitats de veïns i administradors de finques',
  },
  {
    value: 'industria',
    title: 'Per a la seva indústria',
    icon: 'industria',
    desc: 'Naus, polígons i instal·lacions industrials',
  },
] as const;

const STEPS = [
  { key: 'sector', label: 'Tipus de client' },
  { key: 'service', label: 'Servei' },
  { key: 'client', label: 'Dades del client' },
  { key: 'done', label: 'Fet' },
];

const SECTOR_LABEL: Record<string, string> = {
  residencial: 'Llar',
  negocio: 'Negoci',
  comunidades: 'Comunitat',
  industria: 'Indústria',
};

const fmtEuro = (n: number) =>
  new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<Service[]>(FALLBACK_SERVICES);
  const [sector, setSector] = useState<string>('');
  const [serviceId, setServiceId] = useState<string>('');
  const [form, setForm] = useState({ client_name: '', client_phone: '', client_email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getServices()
      .then((res) => {
        if (!active || !res.data) return;
        setServices(res.data);
      })
      .catch(() => {
        // fallback a demo
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () => services.filter((s) => (sector ? s.sector === sector : true)),
    [services, sector],
  );

  const pickSector = (value: string) => {
    setSector(value);
    setServiceId('');
    setStep(1);
  };

  const pickService = (id: string) => {
    setServiceId(id);
    setStep(2);
  };

  const submit = async () => {
    setError(null);
    if (!form.client_name.trim()) {
      setError('Introduïu el nom del client.');
      return;
    }
    setLoading(true);
    try {
      await createReferral({
        client_name: form.client_name.trim(),
        client_phone: form.client_phone.trim() || undefined,
        client_email: form.client_email.trim() || undefined,
        service: serviceId,
        service_type: services.find((s) => s.id === serviceId)?.category,
        source: 'onboarding',
      });
      setStep(3);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No s\'ha pogut enregistrar el lead. Torneu-ho a provar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const selected = services.find((s) => s.id === serviceId);

  return (
    <div className="page-inner">
      <h1 className="page-title">Onboarding de lead</h1>
      <p className="page-sub">Enregistreu un client potencial pas a pas.</p>

      {/* Indicador de passos */}
      <ol className="wizard-steps" aria-label="Progrés del formulari">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < step ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="wizard-dot">{i < step ? <CheckIcon size={14} /> : i + 1}</span>
            <span className="wizard-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="form-card onboard-step">
          <h2 className="onboard-title">A qui volem oferir-ho?</h2>
          <p className="onboard-sub">Trieu el tipus de client per recomanar el servei adequat.</p>
          <div className="sector-grid">
            {SECTOR_STEPS.map((opt) => (
              <button type="button" key={opt.value} className="sector-option" onClick={() => pickSector(opt.value)}>
                <span className="sector-icon" aria-hidden="true">
                  {opt.icon === 'casa' ? (
                    <SparklesIcon size={24} />
                  ) : opt.icon === 'comunitat' ? (
                    <CommunityIcon size={24} />
                  ) : opt.icon === 'industria' ? (
                    <FactoryIcon size={24} />
                  ) : (
                    <BuildingIcon size={24} />
                  )}
                </span>
                <strong>{opt.title}</strong>
                <span className="sector-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="form-card onboard-step">
          <div className="onboard-head">
            <button type="button" className="back" onClick={() => setStep(0)}>
              ← Canviar tipus de client
            </button>
          </div>
          <h2 className="onboard-title">Trieu el servei</h2>
          <p className="onboard-sub">Seleccioneu el servei que millor s'adapta al client.</p>
          <div className="service-list">
            {filtered.map((s) => (
              <button type="button" key={s.id} className="service-option" onClick={() => pickService(s.id)}>
                <span className="service-option-main">
                  <strong>{s.name}</strong>
                  {SECTOR_LABEL[s.sector] && <span className="service-tag">{SECTOR_LABEL[s.sector]}</span>}
                </span>
                <span className="service-option-meta">
                  {s.alta_fee ? `Alta ${fmtEuro(s.alta_fee)}` : 'Pressupost a mida'}
                  {s.monthly_fee ? ` · ${fmtEuro(s.monthly_fee)}/mes` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="form-card onboard-step">
          <div className="onboard-head">
            <button type="button" className="back" onClick={() => setStep(1)}>
              ← Canviar servei
            </button>
          </div>
          <h2 className="onboard-title">Dades del client</h2>
          <p className="onboard-sub">Només el mínim per crear el lead. El nostre equip el contactarà.</p>

          {selected && (
            <div className="onboard-chosen">
              <strong>{selected.name}</strong>
            </div>
          )}

          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="field">
              <span>Nom del client</span>
              <input
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                placeholder="Nom i cognoms"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Telèfon (opcional)</span>
              <input
                type="tel"
                value={form.client_phone}
                onChange={(e) => setForm((f) => ({ ...f, client_phone: e.target.value }))}
                placeholder="600 000 000"
              />
            </label>
            <label className="field">
              <span>Correu electrònic (opcional)</span>
              <input
                type="email"
                value={form.client_email}
                onChange={(e) => setForm((f) => ({ ...f, client_email: e.target.value }))}
                placeholder="client@exemple.cat"
              />
            </label>

            {error && <p className="error">{error}</p>}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Enviant…' : 'Enregistra el lead'}
              </button>
            </div>
          </form>
        </div>
      )}

      {step === 3 && (
        <div className="form-card onboard-step onboard-done">
          <span className="done-icon" aria-hidden="true">
            <CheckIcon size={30} />
          </span>
          <h2 className="onboard-title">Lead enregistrat!</h2>
          <p className="onboard-sub">
            Gràcies. Ho hem rebut i el nostre equip es posarà en contacte amb el client.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate('/referrals')}>
              Veure els meus referits
            </button>
            <button type="button" className="btn-ghost" onClick={() => {
              setStep(0);
              setSector('');
              setServiceId('');
              setForm({ client_name: '', client_phone: '', client_email: '' });
              setError(null);
            }}>
              Enregistrar-ne un altre
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
