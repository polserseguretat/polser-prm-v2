import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getReferral, getReferralEvents, type Referral, type ReferralEvent } from '../lib/api';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Nou',
  contactado: 'Contactat',
  presupuesto: 'Pressupost',
  aceptado: 'Acceptat',
  instalado: 'Instal·lat',
  perdido: 'Perdut',
};

const STATUS_ORDER = ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado'];

export default function ReferralDetail() {
  const { id } = useParams<{ id: string }>();
  const [referral, setReferral] = useState<Referral | null>(null);
  const [events, setEvents] = useState<ReferralEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.allSettled([getReferral(id), getReferralEvents(id)]).then(([r, e]) => {
      if (!active) return;
      if (r.status === 'fulfilled') setReferral(r.value.data ?? null);
      if (e.status === 'fulfilled') setEvents(e.value.data ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="page-inner">
        <p className="muted">Carregant…</p>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="page-inner">
        <h1 className="page-title">Referit no trobat</h1>
        <p className="muted">No s\'ha pogut carregar aquest referit.</p>
        <Link className="btn btn-primary" to="/referrals">
          Torna als meus referits
        </Link>
      </div>
    );
  }

  const isLost = referral.status === 'perdido';
  const currentIndex = isLost ? STATUS_ORDER.length : STATUS_ORDER.indexOf(referral.status);

  const eventDateFor = (toStatus: string) => {
    const event = [...events].reverse().find((e) => e.to_status === toStatus);
    return event ? event.created_at : undefined;
  };

  return (
    <div className="page-inner">
      <Link className="back" to="/referrals">← Els meus referits</Link>
      <h1 className="page-title">{referral.referral_code ?? 'Referit'}</h1>
      <p className="page-sub">
        Enviat el {formatDate(referral.stage_date || referral.created_at)}
        {referral.estimated_value ? ` · Valor estimat ${fmtEuro(referral.estimated_value)}` : ''}
      </p>

      <section className="section">
        <h2 className="section-title">Estat</h2>
        <div className="timeline">
          {STATUS_ORDER.map((s, i) => {
            const reached = i < currentIndex || (isLost && i < currentIndex);
            const current = s === referral.status;
            return (
              <div
                key={s}
                className={'timeline-step' + (reached ? ' reached' : '') + (current ? ' current' : '')}
              >
                <span className="timeline-dot" />
                <div className="timeline-body">
                  <strong>{STATUS_LABEL[s]}</strong>
                  {reached && eventDateFor(s) && <span className="timeline-date">{formatDate(eventDateFor(s))}</span>}
                </div>
              </div>
            );
          })}
          {isLost && (
            <div className="timeline-step cancelled current">
              <span className="timeline-dot" />
              <div className="timeline-body">
                <strong>Perdut</strong>
                <em>No es genera comissió</em>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return 'Data desconeguda';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Data desconeguda';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtEuro(n: number) {
  return new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
}