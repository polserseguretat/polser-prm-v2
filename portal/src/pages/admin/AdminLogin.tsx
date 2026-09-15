import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { adminLogin, ApiError } from '../../lib/adminApi';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/admin';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Introduïu el correu i la contrasenya.');
      return;
    }
    setLoading(true);
    try {
      await adminLogin(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'No s\'ha pogut iniciar la sessió.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login admin-login">
      <div className="login-card">
        <div className="login-logo">P</div>
        <h1 className="login-title">Panell de gestió</h1>
        <p className="login-sub">Accés restringit a superusuaris de POLSER SEGURETAT</p>

        <form onSubmit={submit} className="form">
          <label className="field">
            <span>Correu electrònic</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@polser.cat"
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>Contrasenya</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Entrant…' : 'Entra'}
          </button>
        </form>

        <p className="hint admin-login-foot">
          <Link to="/">← Torna al portal de partners</Link>
        </p>
      </div>
    </div>
  );
}
