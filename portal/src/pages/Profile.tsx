import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPortalMe, getContract, getPushConfig, testPush, assetUrl, type PartnerOrg, type PartnerContract } from '../lib/api';
import { clearToken } from '../lib/session';
import { pushSupported, enablePush, disablePush, ensurePushSubscription, pushUnavailableMessage } from '../lib/push';

const FALLBACK_ORG: PartnerOrg = {
  id: 'p1',
  name: 'Polser Partners SL',
  profile: 'colaborador',
  type: 'administrador_fincas',
  nif: 'B12345678',
  email: 'partners@exemple.cat',
  phone: '+34 600 000 000',
  address: 'Carrer de Provença 300, 08037 Barcelona',
  status: 'actiu',
};

const PROFILE_LABEL: Record<string, string> = {
  afiliat: 'Afiliat',
  colaborador: 'Col·laborador',
};

const TYPE_LABEL: Record<string, string> = {
  inmobiliaria: 'Inmobiliària',
  administrador_fincas: 'Administrador de finques',
  operador_telecom: 'Operador de telecomunicacions',
  autonomo: 'Autònom',
  otro: 'Altres',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendent',
  actiu: 'Actiu',
  inactiu: 'Inactiu',
  bloquejat: 'Bloquejat',
};

const CONTRACT_LABEL: Record<string, string> = {
  no: 'Contracte encara no generat.',
  generating: 'Contracte en preparació…',
  pending_signature: 'Contracte pendent de signatura. Rebreu un correu per signar-lo.',
  signed: 'Contracte signat.',
  canceled: 'Contracte cancel·lat.',
  error: "No s'ha pogut generar el contracte. Contacteu amb POLSER.",
};

export default function Profile() {
  const navigate = useNavigate();
  const [org, setOrg] = useState<PartnerOrg>(FALLBACK_ORG);
  const [email, setEmail] = useState<string | undefined>(undefined);
  const [contract, setContract] = useState<PartnerContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushState, setPushState] = useState<'loading' | 'unsupported' | 'on' | 'off'>('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [pushAvailable, setPushAvailable] = useState<boolean | null>(null);
  const [pushReason, setPushReason] = useState<string | undefined>(undefined);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const iosNeedsInstall = isIOS && !isStandalone;

  const logout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  const togglePush = async () => {
    setPushBusy(true);
    setPushMsg('');
    try {
      if (pushState === 'on') {
        await disablePush();
        setPushState('off');
        setPushMsg('Notificacions desactivades.');
      } else {
        await enablePush();
        setPushState('on');
        setPushMsg('Notificacions activades.');
      }
    } catch (err) {
      setPushMsg((err as Error).message || "No s'han pogut canviar les notificacions.");
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setPushBusy(true);
    setPushMsg('');
    try {
      const res = await testPush('cron');
      const d = res.data;
      setPushMsg(
        d.queued
          ? "Prova en cua. El cron la publica en menys d'un minut; hauria d'arribar al dispositiu."
          : d.published
            ? 'Prova enviada.'
            : "No s'ha pogut enviar: " + (d.detail || 'error desconegut'),
      );
    } catch (err) {
      setPushMsg((err as Error).message || "No s'ha pogut enviar la prova.");
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!pushSupported()) {
        if (active) setPushState('unsupported');
        return;
      }
      try {
        // Reconcilia amb el servidor (renova/re-registra si cal) abans de mirar.
        await ensurePushSubscription();
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (active) setPushState(sub ? 'on' : 'off');
      } catch {
        if (active) setPushState('off');
      }
      // Estat del servei (per mostrar el motiu si no està disponible).
      try {
        const cfg = await getPushConfig();
        if (active) {
          setPushAvailable(!!cfg.data?.enabled);
          setPushReason(cfg.data?.reason);
        }
      } catch {
        if (active) setPushAvailable(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getPortalMe()
      .then((res) => {
        if (!active || !res.data) return;
        setOrg(res.data.partner ?? FALLBACK_ORG);
        setEmail(res.data.user.email);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getContract()
      .then((res) => {
        if (active) setContract(res.data ?? null);
      })
      .catch(() => {
        /* sense contracte o error: es mostra l'estat per defecte */
      });
    return () => {
      active = false;
    };
  }, []);

  const rows: Array<[string, string | undefined]> = [
    ['Perfil', PROFILE_LABEL[org.profile] ?? org.profile],
    ['Tipus', TYPE_LABEL[org.type] ?? org.type],
    ['NIF / DNI', org.nif ?? undefined],
    ['Correu electrònic', email ?? org.email ?? undefined],
    ['Telèfon', org.phone ?? undefined],
    ['Adreça', org.address ?? undefined],
    ['Estat', org.status ? STATUS_LABEL[org.status] ?? org.status : undefined],
  ];

  const pushDenied = pushSupported() && Notification.permission === 'denied';

  return (
    <div className="page-inner">
      <h1 className="page-title">El meu perfil</h1>
      <p className="page-sub">Dades de la vostra organització.</p>

      {loading ? (
        <p className="muted">Carregant…</p>
      ) : (
        <>
          <div className="profile-card">
            <div className="profile-head">
              <span className="brand-logo" aria-hidden="true">
                P
              </span>
              <div className="profile-head-text">
                <h2>{org.name}</h2>
                <span className="profile-role">{PROFILE_LABEL[org.profile] ?? org.profile}</span>
              </div>
            </div>

            <dl className="profile-rows">
              {rows.map(
                ([label, value]) =>
                  value && (
                    <div className="profile-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ),
              )}
            </dl>
          </div>

          <div className="form-card profile-contract">
            <h3>Contracte de col·laboració</h3>
            <p className="hint">{CONTRACT_LABEL[contract?.status ?? 'no'] ?? contract?.status}</p>
            {contract?.status === 'signed' && contract.file && (
              <a
                className="btn btn-primary btn-block"
                href={assetUrl(contract.file)}
                target="_blank"
                rel="noreferrer"
              >
                Visualitza / Descarrega
              </a>
            )}
          </div>

          <div className="form-card profile-push">
            <h3>Notificacions push</h3>
            {pushState === 'unsupported' ? (
              <p className="hint">Aquest navegador no suporta notificacions push.</p>
            ) : pushAvailable === false ? (
              <p className="hint push-unavailable">
                {pushUnavailableMessage(pushReason)} Contacteu amb POLSER si el problema persisteix.
              </p>
            ) : pushDenied ? (
              <p className="hint">
                Les notificacions estan bloquejades per al navegador. Activeu-les a la configuració del
                lloc per rebre avisos.
              </p>
            ) : (
              <>
                <p className="hint">
                  Rebeu avisos al mòbil quan canviï l'estat d'un referit, s'acrediti una comissió o es
                  processi una retirada.
                </p>
                {iosNeedsInstall && (
                  <p className="hint">
                    A l'iPhone/iPad cal instal·lar el portal a la pantalla d'inici per rebre notificacions.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={pushBusy || pushState === 'loading'}
                  onClick={togglePush}
                >
                  {pushBusy
                    ? 'Processant…'
                    : pushState === 'on'
                      ? 'Desactivar notificacions'
                      : 'Activar notificacions'}
                </button>
                {pushState === 'on' && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    disabled={pushBusy}
                    onClick={sendTest}
                  >
                    Envia'm una prova
                  </button>
                )}
                {pushMsg && <p className="hint">{pushMsg}</p>}
              </>
            )}
          </div>

          <button type="button" className="btn btn-ghost btn-block profile-logout" onClick={logout}>
            Tanca la sessió
          </button>
        </>
      )}
    </div>
  );
}