import { useEffect, useState } from 'react';
import { pushSupported, enablePush, hasActiveSubscription } from '../lib/push';
import { getPushConfig } from '../lib/api';
import { BellIcon } from './Icons';

const DISMISS_KEY = 'polser.pushPromptDismissedAt';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000; // no tornar a demanar fins passats 7 dies

/**
 * Banner que apareix en obrir el portal si l'usuari encara no ha activat les
 * notificacions push. No es mostra si: el navegador no ho suporta, el permís
 * està denegat (no es pot re-demanar), ja hi ha subscripció, o l'usuari l'ha
 * descartat fa poc.
 */
export default function PushPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      if (!pushSupported()) return;
      if (Notification.permission === 'denied') return;
      try {
        const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (ts && Date.now() - ts < DISMISS_MS) return;
      } catch {
        /* localStorage no disponible: continuem */
      }
      const sub = await hasActiveSubscription();
      if (!active || sub) return;
      // No mostrem l'avís si el servei de notificacions no està operatiu.
      try {
        const cfg = await getPushConfig();
        if (!active || !cfg.data?.enabled) return;
      } catch {
        return;
      }
      setVisible(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!visible) return null;

  const activate = async () => {
    setBusy(true);
    setError('');
    try {
      await enablePush();
      setVisible(false);
    } catch (err) {
      setError((err as Error).message || "No s'han pogut activar les notificacions.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div className="push-prompt" role="region" aria-label="Activa les notificacions">
      <span className="push-prompt-icon" aria-hidden="true">
        <BellIcon size={20} />
      </span>
      <div className="push-prompt-text">
        <strong>Activa les notificacions</strong>
        <p>
          Rebeu avisos al mòbil quan canviï l'estat d'un referit, s'acrediti una comissió o es
          processi una retirada.
        </p>
        {error && <p className="push-prompt-error">{error}</p>}
      </div>
      <div className="push-prompt-actions">
        <button type="button" className="btn btn-primary" onClick={activate} disabled={busy}>
          {busy ? 'Activant…' : 'Activar'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={dismiss} disabled={busy}>
          Ara no
        </button>
      </div>
    </div>
  );
}
