import { useEffect, useState } from 'react';
import { getWalletLedger, createPayout, ApiError, type WalletEntry } from '../lib/api';

const MIN_PAYOUT = 100;

const TYPE_LABEL: Record<string, string> = {
  high: 'Comissió d\'alta',
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
  const [requesting, setRequesting] = useState(false);
  const [amount, setAmount] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const canWithdraw = balance >= MIN_PAYOUT;

  const requestWithdrawal = async () => {
    setMessage(null);
    setError(null);
    const value = parseFloat(amount.replace(',', '.'));
    if (!value || isNaN(value) || value <= 0) {
      setError('Introduïu una quantitat vàlida.');
      return;
    }
    if (value > balance) {
      setError('La quantitat no pot superar el saldo.');
      return;
    }
    if (value < MIN_PAYOUT) {
      setError(`El mínim per retirar són ${fmtEuro(MIN_PAYOUT)}.`);
      return;
    }

    setRequesting(true);
    try {
      await createPayout(value);
      setMessage('Sol·licitud de retirada enviada correctament.');
      setAmount('');
      setLedger((prev) => [
        { id: `payout-${Date.now()}`, type: 'payout_deduction', amount: -value, period: null, status: 'accrued', description: 'Retirada sol·licitada', created_at: new Date().toISOString() },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No s\'ha pogut processar la sol·licitud.');
    } finally {
      setRequesting(false);
    }
  };

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
            <label className="field">
              <span>Quantitat a retirar (mínim {fmtEuro(MIN_PAYOUT)})</span>
              <input
                type="number"
                min={MIN_PAYOUT}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={fmtEuro(balance)}
              />
            </label>
            <button
              className="btn btn-primary btn-block"
              disabled={!canWithdraw || requesting}
              onClick={requestWithdrawal}
            >
              {requesting
                ? 'Enviant…'
                : canWithdraw
                  ? 'Sol·licitar retirada'
                  : `Sol·licitar retirada (mínim ${fmtEuro(MIN_PAYOUT)})`}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
          {message && <p className="info">{message}</p>}

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
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}