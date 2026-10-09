import { useEffect, useState } from 'react';
import { getWalletLedger, type WalletEntry } from '../lib/api';

const MIN_PAYOUT = 100;
const INVOICE_EMAIL = 'admin@polser.cat';

const TYPE_LABEL: Record<string, string> = {
  high: "Comissió d'alta",
  recurring: 'Comissió recurrent',
  adjustment: 'Ajust',
  payout_deduction: 'Retirada',
  reversal: 'Reversió',
};

const STATUS_LABEL: Record<string, string> = {
  accrued: 'Pendent de cobrament',
  poised: 'Preparada',
  paid: 'Pagada',
  reversed: 'Reversada',
  void: 'Anul·lada',
};

const fmtEuro = (n: number) =>
  new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);

export default function Wallet() {
  const [ledger, setLedger] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getWalletLedger()
      .then((w) => {
        if (active) {
          setLedger(w.data ?? []);
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

  const balance = ledger.reduce((sum, e) => sum + e.amount, 0);
  const pending = ledger
    .filter((e) => ['high', 'recurring', 'adjustment'].includes(e.type) && ['accrued', 'poised'].includes(e.status))
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="page-inner">
      <h1 className="page-title">Cartera</h1>
      <p className="page-sub">Consulteu el vostre saldo i les comissions.</p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : (
        <>
          <div className="wallet-balance">
            <span className="wallet-label">Saldo acumulat</span>
            <span className="wallet-value">{fmtEuro(balance)}</span>
            <span className="wallet-pending">
              Comissions pendents: <strong>{fmtEuro(pending)}</strong>
            </span>
          </div>

          <div className="withdraw-box">
            <p className="hint">
              Per rebre les comissions de la vostra cartera, envieu-nos la factura. Us expliquem com fer-ho.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setGuideOpen(true)}>
              Com retirar els fons?
            </button>
          </div>

          <section className="section">
            <h2 className="section-title">Moviments</h2>
            {ledger.length === 0 ? (
              <p className="empty">Encara no hi ha moviments.</p>
            ) : (
              <ul className="movement-list">
                {ledger.map((m) => (
                  <li className="movement" key={m.id}>
                    <div className="movement-info">
                      <strong>{TYPE_LABEL[m.type] ?? m.type}</strong>
                      <span>
                        {formatDate(m.created_at)}
                        {m.period ? ` · ${m.period}` : ''}
                        {' · '}
                        {STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </div>
                    <span className={m.amount >= 0 ? 'movement-amount positive' : 'movement-amount negative'}>
                      {fmtEuro(m.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {guideOpen && (
        <div className="modal-overlay" onClick={() => setGuideOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retirar-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="modal-close" onClick={() => setGuideOpen(false)} aria-label="Tancar">
              ×
            </button>
            <h2 id="retirar-title" className="modal-title">
              Com retirar els fons?
            </h2>
            <div className="modal-body">
              <p className="modal-desc">
                Per rebre les comissions acumulades a la vostra cartera, seguiu aquests passos:
              </p>
              <ol className="retirar-steps">
                <li>
                  <strong>Comproveu el saldo.</strong> El mínim per retirar és {fmtEuro(MIN_PAYOUT)}.
                </li>
                <li>
                  <strong>Emeteu una factura</strong> a nom de <strong>POLSER SEGURETAT, SL</strong> amb les
                  vostres dades fiscals (nom o raó social i NIF) i:
                  <ul className="retirar-sublist">
                    <li>Concepte: «Comissions referits — període»</li>
                    <li>Import: l'import a retirar (fins al saldo disponible)</li>
                    <li>Número i data de la factura</li>
                  </ul>
                </li>
                <li>
                  <strong>Envieu-nos la factura</strong> en PDF a{' '}
                  <a href={`mailto:${INVOICE_EMAIL}`}>{INVOICE_EMAIL}</a>.
                </li>
                <li>
                  <strong>Rebreu el pagament</strong> per transferència en un termini de 15 dies hàbils des de
                  la recepció de la factura.
                </li>
                <li>
                  Un cop pagada, <strong>l'import es descomptarà de la vostra cartera</strong> i el veureu a
                  «Moviments».
                </li>
              </ol>
              <a
                className="btn btn-primary btn-block"
                href={`mailto:${INVOICE_EMAIL}?subject=Factura%20comissions%20referits`}
              >
                Enviar la factura per correu
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
