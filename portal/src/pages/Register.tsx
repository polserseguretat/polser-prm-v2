import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getInvitation, completeInvitation, ApiError } from '../lib/api';

const TYPE_LABEL: Record<string, string> = {
  inmobiliaria: 'Inmobiliària',
  administrador_fincas: 'Administrador de finques',
  operador_telecom: 'Operador de telecomunicacions',
  autonomo: 'Autònom',
  otro: 'Altres',
};

const TYPE_VALUES = Object.keys(TYPE_LABEL);

type State = 'loading' | 'form' | 'done' | 'invalid';
type LegalForm = 'fisica' | 'juridica';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [type, setType] = useState('');
  const [legalForm, setLegalForm] = useState<LegalForm>('fisica');
  const [nif, setNif] = useState('');
  const [repName, setRepName] = useState('');
  const [repNif, setRepNif] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  // Autònom = sempre persona física
  const isCompany = legalForm === 'juridica' && type !== 'autonomo';

  useEffect(() => {
    let active = true;
    if (!token) {
      if (active) {
        setError("L'enllaç no és vàlid o ha caducat.");
        setState('invalid');
      }
      return;
    }
    getInvitation(token)
      .then((res) => {
        if (!active || !res.data) return;
        setName(res.data.name ?? '');
        setEmail(res.data.email ?? '');
        setType(res.data.type && TYPE_VALUES.includes(res.data.type) ? res.data.type : '');
        setState('form');
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err instanceof ApiError ? err.message : "L'enllaç no és vàlid o ha caducat.";
        setError(msg);
        setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Un cop completada l'alta, redirigeix al login (OTP) automàticament.
  useEffect(() => {
    if (state !== 'done') return;
    const t = window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    return () => window.clearTimeout(t);
  }, [state, navigate]);

  const onTypeChange = (value: string) => {
    setType(value);
    if (value === 'autonomo') setLegalForm('fisica');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!type) {
      setError('Seleccioneu el tipus de partner.');
      return;
    }
    if (!nif.trim()) {
      setError('El NIF és obligatori.');
      return;
    }
    if (isCompany && (!repName.trim() || !repNif.trim())) {
      setError("Cal el nom i el NIF del representant de l'empresa.");
      return;
    }

    setSaving(true);
    try {
      await completeInvitation(token, {
        name: name.trim(),
        type,
        nif: nif.trim(),
        is_company: isCompany,
        legal_rep_name: isCompany ? repName.trim() : undefined,
        legal_rep_nif: isCompany ? repNif.trim() : undefined,
        phone: phone.trim(),
        address: address.trim(),
      });
      setState('done');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No s\'ha pogut completar l\'alta. Proveu-ho de nou.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">P</div>
        <h1 className="login-title">Creeu la vostra fitxa</h1>
        <p className="login-sub">Alta al Portal de Partners de POLSER SEGURETAT</p>

        {state === 'loading' ? (
          <p className="hint">Carregant…</p>
        ) : state === 'invalid' ? (
          <>
            <p className="error">{error ?? "L'enllaç no és vàlid o ha caducat."}</p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate('/login')}>
              Vés a l'accés
            </button>
          </>
        ) : state === 'done' ? (
          <>
            <p className="info">La vostra fitxa s'ha creat correctament. Us portem a l'accés…</p>
            <button className="btn btn-primary btn-block" type="button" onClick={() => navigate('/login')}>
              Accedeix ara
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="form">
            <p className="hint">
              <strong>Afiliat: 60 € per alta.</strong>
            </p>

            <label className="field">
              <span>Tipus de partner</span>
              <select value={type} onChange={(e) => onTypeChange(e.target.value)} required>
                <option value="">Seleccioneu…</option>
                {TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Forma jurídica</span>
              <select
                value={legalForm}
                onChange={(e) => setLegalForm(e.target.value as LegalForm)}
                disabled={type === 'autonomo'}
              >
                <option value="fisica">Persona física</option>
                <option value="juridica">Persona jurídica (empresa)</option>
              </select>
            </label>

            <label className="field">
              <span>{isCompany ? 'Raó social' : 'Nom i cognoms'}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isCompany ? "Raó social de l'empresa" : 'Nom i cognoms'}
                maxLength={200}
                required
              />
            </label>

            <label className="field">
              <span>{isCompany ? 'CIF' : 'DNI / NIF'}</span>
              <input
                type="text"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                placeholder={isCompany ? 'B12345678' : '12345678A'}
                maxLength={20}
                required
              />
            </label>

            <label className="field">
              <span>Correu electrònic</span>
              <input type="email" value={email} readOnly />
            </label>

            {isCompany && (
              <>
                <label className="field">
                  <span>Nom del representant / administrador</span>
                  <input
                    type="text"
                    value={repName}
                    onChange={(e) => setRepName(e.target.value)}
                    placeholder="Nom i cognoms"
                    maxLength={200}
                    required
                  />
                </label>

                <label className="field">
                  <span>NIF del representant</span>
                  <input
                    type="text"
                    value={repNif}
                    onChange={(e) => setRepNif(e.target.value)}
                    placeholder="12345678A"
                    maxLength={20}
                    required
                  />
                </label>
              </>
            )}

            <label className="field">
              <span>Telèfon</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 600 000 000"
                maxLength={50}
              />
            </label>

            <label className="field">
              <span>Adreça</span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Carrer, número, ciutat"
                maxLength={300}
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Desant…' : 'Completa l\'alta'}
            </button>
            <p className="hint">
              En completar l'alta, rebrem les vostres dades i properament rebreu el contracte de
              col·laboració per signar-lo electrònicament.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}