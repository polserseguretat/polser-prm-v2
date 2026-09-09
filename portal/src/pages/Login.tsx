import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loginRequestOtp, loginVerifyOtp, ApiError } from '../lib/api';
import { setToken } from '../lib/session';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Introduïu una adreça de correu vàlida.');
      return;
    }

    setLoading(true);
    try {
      await loginRequestOtp(email.trim());
      setStep('code');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No s\'ha pogut enviar el codi. Proveu-ho de nou.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^\d{6}$/.test(code)) {
      setError('El codi ha de tenir 6 dígits.');
      return;
    }

    setLoading(true);
    try {
      const result = await loginVerifyOtp(email.trim(), code);
      if (result.access_token) setToken(result.access_token);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Codi incorrecte. Torneu-ho a provar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">P</div>
        <h1 className="login-title">POLSER Partners</h1>
        <p className="login-sub">Accés al portal de partners de POLSER SEGURETAT</p>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="form">
            <label className="field">
              <span>Correu electrònic</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@exemple.cat"
                autoFocus
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Enviant…' : 'Envia el codi'}
            </button>
            <p className="hint">Sense contrasenya: us enviarem un codi de 6 dígits al vostre correu.</p>
          </form>
        ) : (
          <form onSubmit={verify} className="form">
            <label className="field">
              <span>Codi de verificació</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                autoFocus
              />
            </label>
            <p className="hint">S\'ha enviat un codi de 6 dígits a <strong>{email}</strong>.</p>

            {error && <p className="error">{error}</p>}

            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Verificant…' : 'Entra'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Canvia el correu
            </button>
          </form>
        )}
      </div>
    </div>
  );
}