/**
 * Web Push (ntfy) — subscripció del navegador des de la PWA.
 *
 * El backend (PocketBase) exposa:
 *   GET    /api/portal/push/config      -> VAPID pública + topic + estat
 *   POST   /api/portal/push/subscribe   -> registra la subscripció a ntfy
 *   DELETE /api/portal/push/subscribe   -> l'elimina
 *
 * El topic és privat de cada usuari; el token de publicació mai surt del
 * servidor. En iOS només funciona amb la PWA instal·lada a la pantalla d'inici.
 */

import { getPushConfig, subscribePush, unsubscribePush, type BrowserPushSubscription } from './api';

/** Missatges llegibles per als motius que retorna /api/portal/push/config. */
const PUSH_REASON_MSG: Record<string, string> = {
  ntfy_no_configurat: 'El servidor no té configurat el servei de notificacions (falta NTFY_URL).',
  ntfy_inabastable: 'El servidor no pot contactar amb el servei de notificacions (ntfy).',
  webpush_desactivat: 'El Web Push està desactivat al servidor (falten les claus VAPID).',
};

export function pushUnavailableMessage(reason?: string): string {
  if (reason && PUSH_REASON_MSG[reason]) return PUSH_REASON_MSG[reason];
  if (reason) return 'El servei de notificacions no està disponible (' + reason + ').';
  return 'El servei de notificacions no està disponible.';
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Converteix una clau VAPID base64url en ArrayBuffer (Safari ho requereix). */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return buffer;
}

function serialize(sub: PushSubscription): BrowserPushSubscription {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

// Recorda amb quina clau VAPID es va crear la subscripció. Si la clau de ntfy
// canvia (o no la coneixem), cal recrear la subscripció: si no, ntfy signa amb
// una clau que no coincideix i el push no s'entrega mai.
const VAPID_KEY_STORAGE = 'polser.pushVapidKey';

function rememberVapidKey(key: string): void {
  try { localStorage.setItem(VAPID_KEY_STORAGE, key); } catch { /* ignore */ }
}

function knownVapidKey(): string {
  try { return localStorage.getItem(VAPID_KEY_STORAGE) || ''; } catch { return ''; }
}

/** Activa el push. Cal cridar-ho des d'un gest de l'usuari (demana permís). */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Aquest navegador no suporta notificacions push.');

  // IMPORTANT: demanar el permís EL PRIMER, dins del mateix gest de l'usuari.
  // A iOS Safari, si es fa un `await` abans de requestPermission() es perd
  // l'activació transitòria i la petició de permisos es rebutja silenciosament.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Cal permetre les notificacions per activar-les.');
  }

  const cfg = await getPushConfig();
  if (!cfg.data?.enabled || !cfg.data.vapid_public_key) {
    throw new Error(pushUnavailableMessage(cfg.data?.reason));
  }

  const reg = await navigator.serviceWorker.ready;

  // Recrea la subscripció per assegurar que és amb la VAPID actual.
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    sub = null;
  }
  sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.data.vapid_public_key),
  });

  await subscribePush(serialize(sub));
  rememberVapidKey(cfg.data.vapid_public_key);
}

/** Desactiva el push (local + servidor). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await unsubscribePush(sub.endpoint); } catch { /* best-effort */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  } else {
    try { await unsubscribePush(''); } catch { /* neteja d'estat */ }
  }
}

/**
 * Renova silenciosament la subscripció si l'usuari ja havia donat permís.
 * Es crida a l'arrencada de la PWA perquè les subscripcions no caduquin.
 */
export async function ensurePushSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const cfg = await getPushConfig();
    if (!cfg.data?.enabled || !cfg.data.vapid_public_key) return;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // Si la clau VAPID de ntfy ha canviat (o no la teníem registrada), recrea
    // la subscripció perquè ntfy pugui signar-la correctament.
    const keyChanged = knownVapidKey() !== cfg.data.vapid_public_key;
    if (sub && keyChanged) {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      sub = null;
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.data.vapid_public_key),
      });
    }
    await subscribePush(serialize(sub));
    rememberVapidKey(cfg.data.vapid_public_key);
  } catch {
    /* silenciós: no molestar l'usuari a l'arrencada */
  }
}

/** Permís de notificacions actual ('unsupported' si el navegador no ho suporta). */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Hi ha una subscripció push activa en aquest navegador? */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Escolta l'avís del service worker que la subscripció està a punt de caducar
 * i la renova. S'ha de cridar un cop a l'arrencada de l'app.
 */
export function watchPushSubscription(): void {
  if (!pushSupported()) return;
  try {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'push-subscription-expiring') {
        ensurePushSubscription();
      }
    });
  } catch {
    /* ignore */
  }
}
