/**
 * Client Directus per al Portal de Partners de POLSER SEGURETAT (F4).
 * Apunta a les col·leccions reals de Directus (/items). L'aïllament per partner
 * es resol server-side amb els permisos ($CURRENT_USER.partner); el portal només
 * rep les dades que el rol `partner` pot veure (mai dades personals del client).
 */

import { getToken, clearToken } from './session';

export const BASE_URL = import.meta.env.VITE_DIRECTUS_URL || 'http://localhost:8055';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
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

  const response = await fetch(`${BASE_URL}${path}`, init);

  // Sessió caducada o no vàlida: esborra el token
  if (response.status === 401 && token) {
    clearToken();
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
    const directusMessage = (data as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message;
    const message =
      directusMessage ||
      (data as { message?: string })?.message ||
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

/** URL d'un fitxer de Directus (materials) amb el token inclòs */
export function assetUrl(fileId: string): string {
  const token = getToken() ?? '';
  return `${BASE_URL}/assets/${fileId}?access_token=${encodeURIComponent(token)}`;
}

/* ---- Tipus (model real del plan §3) ---- */

export interface AuthResult {
  access_token?: string;
  expires?: number;
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
}

export interface Referral {
  id: string;
  partner: string | null;
  referral_code: string | null;
  service: string | null;
  service_type: string | null;
  status: string;
  stage_date: string;
  estimated_value: number | null;
  source: string;
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
  title: string;
  body: string | null;
  image: string | null;
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

export interface Me {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  partner?: string | null;
}

/* ---- Endpoints ---- */

export function loginRequestOtp(email: string): Promise<AuthResult> {
  return request<AuthResult>('/auth-otp/request-otp', {
    method: 'POST',
    body: { email },
  });
}

export function loginVerifyOtp(email: string, code: string): Promise<AuthResult> {
  return request<AuthResult>('/auth-otp/verify-otp', {
    method: 'POST',
    body: { email, code },
  });
}

export function getServices(): Promise<{ data: Service[] }> {
  return request<{ data: Service[] }>('/portal/services');
}

export function getReferrals(): Promise<{ data: Referral[] }> {
  return request<{ data: Referral[] }>('/portal/referrals');
}

export function getReferral(id: string | number): Promise<{ data: Referral }> {
  return request<{ data: Referral }>(`/portal/referrals/${id}`);
}

export function getReferralEvents(id: string | number): Promise<{ data: ReferralEvent[] }> {
  return request<{ data: ReferralEvent[] }>(`/portal/referrals/${id}/events`);
}

export function createReferral(payload: ReferralPayload): Promise<{ data: Referral }> {
  return request<{ data: Referral }>('/portal/referrals', {
    method: 'POST',
    body: payload,
  });
}

export function getWalletLedger(): Promise<{ data: WalletEntry[] }> {
  return request<{ data: WalletEntry[] }>('/portal/wallet');
}

export function createPayout(amount: number): Promise<{ data: { id: string } }> {
  return request<{ data: { id: string } }>('/portal/payouts', {
    method: 'POST',
    body: { amount },
  });
}

export function getMaterials(): Promise<{ data: DocumentItem[] }> {
  return request<{ data: DocumentItem[] }>('/portal/documents');
}

export function getNotifications(): Promise<{ data: NotificationItem[] }> {
  return request<{ data: NotificationItem[] }>('/portal/notifications');
}

export interface PortalMe {
  user: { id: string; email: string; role: string };
  partner: PartnerOrg;
}

export function getPortalMe(): Promise<{ data: PortalMe }> {
  return request<{ data: PortalMe }>('/portal/me');
}