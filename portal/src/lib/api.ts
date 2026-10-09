/**
 * Client PocketBase per al Portal de Partners de POLSER SEGURETAT.
 * El portal, l'admin (/_/) i l'API (/api/*) viuen al mateix origen:
 * per això BASE_URL és relatiu (VITE_POCKETBASE_URL només cal si l'API
 * és en un altre origen). Auth = OTP natiu de la col·lecció partner_users.
 */

import { getToken, setToken, clearToken } from './session';

export const BASE_URL = import.meta.env.VITE_POCKETBASE_URL || '';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Renova el token de sessió (`auth-refresh`) amb el token actual i desa'n el nou.
 * Retorna `true` si s'ha pogut renovar. Es deduplica si hi ha diverses crides
 * alhora. Usa `fetch` directe per no entrar en recursió amb `request`.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await fetch(`${BASE_URL}/api/collections/partner_users/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token?: string };
      if (data && data.token) {
        setToken(data.token);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;

  const init: RequestInit = {
    method,
    headers: {
      Accept: 'application/json',
    },
  };

  const token = getToken();
  if (token) {
    init.headers = {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    };
  }

  if (body !== undefined) {
    init.headers = {
      ...init.headers,
      'Content-Type': 'application/json',
    };
    init.body = JSON.stringify(body);
  }

  let response = await fetch(`${BASE_URL}${path}`, init);

  // Sessió caducada: prova de renovar-la i reintenta la petició una vegada.
  if (response.status === 401 && token) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const newToken = getToken();
      response = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${newToken}` },
      });
    }
    if (response.status === 401) clearToken();
  }

  // Resposta sense cos (ex. 204)
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(`Resposta invàlida del servidor (${response.status})`, response.status);
    }
  }

  if (!response.ok) {
    const message =
      (data as { message?: string } | null)?.message ||
      (data as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ||
      `Error del servidor (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

/** URL d'un fitxer de PocketBase (els endpoints del portal ja la tornen completa) */
export function assetUrl(file: string): string {
  if (/^https?:\/\//.test(file)) return file;
  if (file.startsWith('/')) return `${BASE_URL}${file}`;
  return file;
}

/* ---- Tipus (model PRM v2) ---- */

export interface OtpRequestResult {
  otpId?: string;
}

export interface AuthResult {
  token?: string;
  record?: Record<string, unknown>;
}

export interface Service {
  id: string;
  code: string;
  name: string;
  category: string;
  sector: string;
  alta_fee: number | null;
  monthly_fee: number | null;
  iva_included: boolean;
  details: Record<string, unknown> | null;
  active: boolean;
  /** Metadades de presentació (modal d'info): { description, image }.
   *  El nom i preus venen dels camps propis, no es dupliquen aquí. */
  presentation?: { description?: string; image?: string } | null;
}

export interface Referral {
  id: string;
  partner: string | null;
  referral_code: string | null;
  service: string | Service | null;
  service_type: string | null;
  status: string;
  stage_date: string;
  estimated_value: number | null;
  final_value: number | null;
  partner_commission_alta: number | null;
  partner_commission_recurrente: number | null;
  source: string;
  // Client (només visible pel partner propietari)
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  client_address: string | null;
  notes: string | null;
  // Sincronització amb Odoo
  odo_opportunity_id: number | null;
  odo_customer_id: number | null;
  odo_sale_id: number | null;
  odoo_sync_status: string;
  created_at: string;
  updated_at: string;
}

export interface ReferralPayload {
  client_name: string;
  client_phone?: string;
  client_email?: string;
  client_address?: string;
  service: string;
  service_type?: string;
  notes?: string;
  source?: string;
}

export interface ReferralEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  lost_reason: string | null;
  created_at: string;
}

export interface WalletEntry {
  id: string;
  type: string;
  amount: number;
  period: string | null;
  status: string;
  description: string | null;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  type: string | null;
  category: string | null;
  file: string | null;
  version: string | null;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  delivery_id: string;
  title: string;
  body: string | null;
  image: string | null;
  link?: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PartnerOrg {
  id: string;
  name: string;
  profile: string;
  type: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
}

export interface PortalMe {
  user: { id: string; email: string; role: string };
  partner: PartnerOrg;
}

export interface InvitationInfo {
  name: string;
  email: string;
  type: string;
}

export interface InvitationPayload {
  name?: string;
  type: string;
  nif: string;
  is_company: boolean;
  legal_rep_name?: string;
  legal_rep_nif?: string;
  phone?: string;
  address?: string;
}

export interface InvitePartnerResult {
  partner_id: string;
  email: string;
  invite_url: string;
  expires_at: string;
  mail_sent: boolean;
}

/* ---- Auth (OTP natiu PocketBase, col·lecció partner_users) ---- */

export function loginRequestOtp(email: string): Promise<OtpRequestResult> {
  return request<OtpRequestResult>('/api/collections/partner_users/request-otp', {
    method: 'POST',
    body: { email },
  });
}

export function loginVerifyOtp(otpId: string, code: string): Promise<AuthResult> {
  return request<AuthResult>('/api/collections/partner_users/auth-with-otp', {
    method: 'POST',
    body: { otpId, password: code },
  });
}

/* ---- Endpoints del portal (/api/portal/*) ---- */

export function getServices(): Promise<{ data: Service[] }> {
  return request<{ data: Service[] }>('/api/portal/services');
}

export function getReferrals(): Promise<{ data: Referral[] }> {
  return request<{ data: Referral[] }>('/api/portal/referrals');
}

export function getReferral(id: string | number): Promise<{ data: Referral }> {
  return request<{ data: Referral }>(`/api/portal/referrals/${id}`);
}

export function getReferralEvents(id: string | number): Promise<{ data: ReferralEvent[] }> {
  return request<{ data: ReferralEvent[] }>(`/api/portal/referrals/${id}/events`);
}

export function createReferral(payload: ReferralPayload): Promise<{ data: Referral }> {
  return request<{ data: Referral }>('/api/portal/referrals', {
    method: 'POST',
    body: payload,
  });
}

export function getWalletLedger(): Promise<{ data: WalletEntry[] }> {
  return request<{ data: WalletEntry[] }>('/api/portal/wallet');
}

export function getMaterials(): Promise<{ data: DocumentItem[] }> {
  return request<{ data: DocumentItem[] }>('/api/portal/documents');
}

export function getNotifications(): Promise<{ data: NotificationItem[] }> {
  return request<{ data: NotificationItem[] }>('/api/portal/notifications');
}

/** Nombre de notificacions no llegides (per al badge de la campana). */
export function getUnreadCount(): Promise<{ data: { count: number } }> {
  return request<{ data: { count: number } }>('/api/portal/notifications/unread-count');
}

/** Marca l'última obertura de l'app (per al recordatori de re-engagement). */
export function pingSession(): Promise<{ data: { ok: boolean } }> {
  return request<{ data: { ok: boolean } }>('/api/portal/ping', { method: 'POST' });
}

/** Marca una notificació com a llegida (persistent al servidor). */
export function markNotificationRead(
  deliveryId: string,
): Promise<{ data: { delivery_id: string; read_at: string } }> {
  return request<{ data: { delivery_id: string; read_at: string } }>(
    `/api/portal/notifications/${encodeURIComponent(deliveryId)}/read`,
    { method: 'POST' },
  );
}

/** Marca totes les notificacions de l'usuari com a llegides. */
export function markAllNotificationsRead(): Promise<{ data: { updated: number } }> {
  return request<{ data: { updated: number } }>('/api/portal/notifications/read-all', {
    method: 'POST',
  });
}

/* ---- Notificacions push (Web Push via ntfy) ---- */

export interface PushConfig {
  enabled: boolean;
  topic: string;
  vapid_public_key: string;
  subscribed: boolean;
  /** Motiu quan `enabled` és false (diagnòstic): ntfy_inabastable, webpush_desactivat, … */
  reason?: string;
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function getPushConfig(): Promise<{ data: PushConfig }> {
  return request<{ data: PushConfig }>('/api/portal/push/config');
}

export function subscribePush(
  subscription: BrowserPushSubscription,
): Promise<{ data: { enabled: boolean; topic: string } }> {
  return request<{ data: { enabled: boolean; topic: string } }>('/api/portal/push/subscribe', {
    method: 'POST',
    body: subscription,
  });
}

export function unsubscribePush(endpoint: string): Promise<{ data: { enabled: boolean } }> {
  return request<{ data: { enabled: boolean } }>('/api/portal/push/subscribe', {
    method: 'DELETE',
    body: { endpoint },
  });
}

export interface PushTestResult {
  via: 'cron' | 'direct';
  topic: string;
  subscribed?: boolean;
  queued?: boolean;
  delivery_id?: string;
  published?: boolean;
  status?: number;
  detail?: string;
}

export function testPush(via: 'cron' | 'direct' = 'cron'): Promise<{ data: PushTestResult }> {
  return request<{ data: PushTestResult }>('/api/portal/push/test', {
    method: 'POST',
    body: { via },
  });
}

export function getPortalMe(): Promise<{ data: PortalMe }> {
  return request<{ data: PortalMe }>('/api/portal/me');
}

/* ---- Alta per invitació (públic; no requereix sessió) ---- */

export function getInvitation(token: string): Promise<{ data: InvitationInfo }> {
  return request<{ data: InvitationInfo }>(`/api/portal/invitations/${encodeURIComponent(token)}`);
}

export function completeInvitation(token: string, payload: InvitationPayload): Promise<{ data: { partner_id: string; user_id: string; status: string } }> {
  return request<{ data: { partner_id: string; user_id: string; status: string } }>(`/api/portal/invitations/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: payload,
  });
}

/* ---- Contracte de col·laborador ---- */

export interface PartnerContract {
  status: string;
  file: string | null;
}

export function getContract(): Promise<{ data: PartnerContract }> {
  return request<{ data: PartnerContract }>('/api/portal/contract');
}
