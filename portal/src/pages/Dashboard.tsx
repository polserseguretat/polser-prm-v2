import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReferrals, getWalletLedger, type Referral, type WalletEntry } from '../lib/api';
import { FileIcon, ChevronRightIcon, SparklesIcon } from '../components/Icons';

const fmtEuro = (n: number) =>
  new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

export default function Dashboard() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [ledger, setLedger] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.allSettled([getReferrals(), getWalletLedger()])
      .then(([r, w]) => {
        if (!active) return;
        if (r.status === 'fulfilled') setReferrals(r.value.data ?? []);
        if (w.status === 'fulfilled') setLedger(w.value.data ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const sent = referrals.length;
  const completed = referrals.filter((r) => r.status === 'instalado').length;
  const accumulatedCommission = ledger
    .filter((e) => ['high', 'recurring', 'adjustment'].includes(e.type))
    .reduce((sum, e) => sum + e.amount, 0);
  const walletBalance = ledger.reduce((sum, e) => sum + e.amount, 0);

  const counters = [
    { label: 'Referits enviats', value: sent },
    { label: 'Referits completats', value: completed },
    { label: 'Comissions acumulades', value: fmtEuro(accumulatedCommission) },
    { label: 'Saldo de la cartera', value: fmtEuro(walletBalance) },
  ];

  return (
    <div className="page-inner">
      <h1 className="page-title">Hola, partner 👋</h1>
      <p className="page-sub">Aquest és el resum de la vostra activitat.</p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : (
        <>
          <div className="grid-counters">
            {counters.map((c) => (
              <div className="counter" key={c.label}>
                <span className="counter-value">{c.value}</span>
                <span className="counter-label">{c.label}</span>
              </div>
            ))}
          </div>

          <section className="section">
            <Link className="onboarding-card" to="/onboarding">
              <span className="onboarding-card-glow" aria-hidden="true" />
              <span className="onboarding-card-icon" aria-hidden="true">
                <SparklesIcon size={26} />
              </span>
              <span className="onboarding-card-text">
                <strong>Ofereix al teu client el que necessita</strong>
                <span>
                  Respon unes preguntes ràpides i enregistra el lead en menys d'un minut.
                </span>
              </span>
              <span className="btn btn-white onboarding-card-cta">
                Començar ara <ChevronRightIcon size={18} />
              </span>
            </Link>
          </section>

          <section className="section">
            <Link className="quick-card" to="/materials">
              <span className="quick-card-icon" aria-hidden="true">
                <FileIcon />
              </span>
              <span className="quick-card-text">
                <strong>Materials i recursos</strong>
                <span>Contractes, manuals i documents per a la vostra activitat comercial.</span>
              </span>
              <ChevronRightIcon />
            </Link>
          </section>
        </>
      )}
    </div>
  );
}
