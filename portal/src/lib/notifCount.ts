/**
 * Estat compartit del recompte de notificacions no llegides (badge de la campana).
 * Molt lleuger: un pub/sub en memòria, sense llibreries.
 *
 * - `refreshUnread()` consulta el servidor i notifica els subscriptors.
 * - `setUnread(n)` fixa el valor localment (p. ex. després de marcar llegides).
 * - `subscribeUnread(fn)` subscriu i retorna la funció de baixa.
 */
import { getUnreadCount } from './api';

type Listener = (count: number) => void;

const listeners = new Set<Listener>();
let current = 0;

export function subscribeUnread(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

export function setUnread(count: number): void {
  current = Math.max(0, Math.floor(count));
  listeners.forEach((fn) => fn(current));
}

export async function refreshUnread(): Promise<void> {
  try {
    const res = await getUnreadCount();
    setUnread(res.data?.count ?? 0);
  } catch {
    /* silenciós: el badge no és crític */
  }
}
