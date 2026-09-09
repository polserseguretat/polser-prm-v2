import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReferrals, type Referral } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Nou',
  contactado: 'Contactat',
  presupuesto: 'Pressupost',
  aceptado: 'Acceptat',
  instalado: 'Instal·lat',
  perdido: 'Perdut',
};

const STATUS_ORDER = ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado', 'perdido'];

export default function Referrals() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [status, setStatus] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getReferrals()
      .then((r) => {
        if (active) {
          setReferrals(r.data ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = status === 'all' ? referrals : referrals.filter((r) => r.status === status);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Els meus referits</h1>
          <p className="page-sub">Gestioneu les vostres referències de clients.</p>
        </div>
        <Link className="btn btn-primary" to="/onboarding">
          Nou referit
        </Link>
      </div>

      <div className="chip-row">
        {['all', ...STATUS_ORDER].map((s) => (
          <button
            key={s}
            type="button"
            className={status === s ? 'chip active' : 'chip'}
            onClick={() => setStatus(s)}
          >
            {s === 'all' ? 'Tots' : STATUS_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No hi ha cap referit en aquest estat.</p>
      ) : (
        <div className="referral-list">
          {filtered.map((r) => (
            <Link className="referral-card" to={`/referrals/${r.id}`} key={r.id}>
              <div className="referral-main">
                <strong>{r.referral_code ?? 'Referit'}</strong>
                <span className="referral-date">{formatDate(r.stage_date || r.created_at)}</span>
              </div>
              <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return 'Data desconeguda';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Data desconeguda';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}