/**
 * Client del panell d'administració (/admin).
 *
 * A diferència del portal de partners, el panell s'autentica com a
 * SUPERUSUARI de PocketBase. Amb el seu Bearer token es pot usar l'API
 * REST nativa de PB (`/api/collections/<col>/records`), que ignora les
 * regles de col·lecció, i els endpoints propis del panell
 * (`/api/admin/*`, definits a `pb_hooks/_admin.pb.js`).
 *
 * IMPORTANT: aquest mòdul NO toca el token del portal (`polser_token`).
 */

import { ApiError, BASE_URL } from './api';
import { getAdminToken, clearAdminSession, setAdminSession, getAdminEmail } from './adminSession';

export { ApiError };

interface AdminRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  formData?: FormData;
}

async function adminRequest<T>(path: string, options: AdminRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData } = options;
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };

  const token = getAdminToken();
  if (token) init.headers = { ...init.headers, Authorization: `Bearer ${token}` };

  if (formData) {
    init.body = formData;
  } else if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, init);

  if (response.status === 401 && token) {
    clearAdminSession();
  }

  if (response.status === 204) return undefined as T;

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

/* =====================================================================
 * Auth (superusuari)
 * ===================================================================== */

interface SuperuserAuthResult {
  token: string;
  record?: { id: string; email: string };
}

export async function adminLogin(identity: string, password: string): Promise<void> {
  const res = await adminRequest<SuperuserAuthResult>('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: { identity, password },
  });
  if (!res.token) throw new ApiError('No s\'ha pogut iniciar la sessió.');
  setAdminSession(res.token, res.record?.email || identity);
}

export function adminLogout(): void {
  clearAdminSession();
}

export function currentAdminEmail(): string | null {
  return getAdminEmail();
}

/* =====================================================================
 * API nativa de PocketBase (CRUD per a superusuari)
 * ===================================================================== */

export interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

export interface ListParams {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  expand?: string;
}

function queryString(params: ListParams = {}): string {
  const q = new URLSearchParams();
  if (params.filter) q.set('filter', params.filter);
  if (params.sort) q.set('sort', params.sort);
  if (params.page) q.set('page', String(params.page));
  if (params.perPage) q.set('perPage', String(params.perPage));
  if (params.expand) q.set('expand', params.expand);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Cita un valor per als filtres de PocketBase (escapant cometes simples). */
export function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function listRecords<T>(collection: string, params?: ListParams): Promise<ListResult<T>> {
  return adminRequest<ListResult<T>>(`/api/collections/${collection}/records${queryString(params)}`);
}

export function getRecord<T>(collection: string, id: string, expand?: string): Promise<T> {
  const q = expand ? `?expand=${encodeURIComponent(expand)}` : '';
  return adminRequest<T>(`/api/collections/${collection}/records/${id}${q}`);
}

export function createRecord<T>(collection: string, body: Record<string, unknown>): Promise<T> {
  return adminRequest<T>(`/api/collections/${collection}/records`, { method: 'POST', body });
}

export function updateRecord<T>(collection: string, id: string, body: Record<string, unknown>): Promise<T> {
  return adminRequest<T>(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', body });
}

export function deleteRecord(collection: string, id: string): Promise<void> {
  return adminRequest<void>(`/api/collections/${collection}/records/${id}`, { method: 'DELETE' });
}

export function uploadRecord<T>(collection: string, formData: FormData, id?: string): Promise<T> {
  const path = id
    ? `/api/collections/${collection}/records/${id}`
    : `/api/collections/${collection}/records`;
  return adminRequest<T>(path, { method: id ? 'PATCH' : 'POST', formData });
}

/* =====================================================================
 * Endpoints propis del panell (/api/admin/*)
 * ===================================================================== */

export interface AdminStats {
  partners: {
    total: number;
    active: number;
    pending: number;
    byStatus: Record<string, number>;
    byProfile: Record<string, number>;
    byType: Record<string, number>;
  };
  referrals: {
    total: number;
    installed: number;
    lost: number;
    conversionRate: number;
    byStatus: Record<string, number>;
  };
  wallet: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  };
  payouts: {
    total: number;
    pending: number;
    paid: number;
    amount: number;
    byStatus: Record<string, number>;
  };
  outbox: { total: number; byStatus: Record<string, number> };
  notifications: { total: number; byStatus: Record<string, number> };
  alerts: {
    outboxErrors: number;
    pendingPayouts: number;
    contractsPendingSignature: number;
    expiredInvitations: number;
  };
  series: Array<{ month: string; referrals: number; partners: number; commissions: number }>;
  generatedAt: string;
}

export function adminGetStats(): Promise<{ data: AdminStats }> {
  return adminRequest<{ data: AdminStats }>('/api/admin/stats');
}

export interface OutboxErrorRow {
  id: string;
  entity: string | null;
  entity_id: string | null;
  action: string | null;
  status: string;
  attempts: number;
  last_error: string;
  updated_at: string;
}

export interface OutboxHealth {
  total: number;
  byStatus: Record<string, number>;
  errors: OutboxErrorRow[];
}

export function adminOutboxHealth(): Promise<{ data: OutboxHealth }> {
  return adminRequest<{ data: OutboxHealth }>('/api/admin/outbox-health');
}

export function adminRetryOutbox(id: string): Promise<{ data: { id: string; status: string } }> {
  return adminRequest(`/api/admin/outbox/${id}/retry`, { method: 'POST' });
}

export function adminSendNotification(id: string): Promise<{ data: { id: string; delivered: number; status: string } }> {
  return adminRequest(`/api/admin/notifications/${id}/send`, { method: 'POST' });
}

export interface CreateUserPayload {
  email: string;
  role: string;
  name?: string;
  partner?: string;
}

export function adminCreateUser(payload: CreateUserPayload): Promise<{ data: { id: string; email: string; role: string } }> {
  return adminRequest('/api/admin/users', { method: 'POST', body: payload });
}

export interface InvitePartnerPayload {
  name: string;
  email: string;
}

export interface InvitePartnerResult {
  partner_id: string;
  email: string;
  invite_url: string;
  expires_at: string;
  mail_sent: boolean;
}

export function adminInvitePartner(payload: InvitePartnerPayload): Promise<{ data: InvitePartnerResult }> {
  return adminRequest('/api/admin/partners/invite', { method: 'POST', body: payload });
}

export interface AuditPayload {
  actor?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  payload?: Record<string, unknown>;
}

export function adminAudit(payload: AuditPayload): Promise<{ data: { id: string } }> {
  return adminRequest('/api/admin/audit', { method: 'POST', body: payload });
}

/* =====================================================================
 * Tipus de les col·leccions del PRM
 * ===================================================================== */

export interface PBRecord {
  id: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

export interface Partner extends PBRecord {
  name: string;
  profile: string;
  type: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  activation_date: string | null;
  contract_file: string | null;
  notes: string | null;
  invite_expires_at: string | null;
  invited_at: string | null;
  onboarding_completed_at: string | null;
  is_company: boolean;
  legal_rep_name: string | null;
  legal_rep_nif: string | null;
  contract_status: string;
  odo_partner_id: number | null;
  contract_generated_at: string | null;
  contract_sent_at: string | null;
  contract_signed_at: string | null;
}

export interface PartnerUser extends PBRecord {
  email: string;
  role: string;
  partner: string | null;
  name: string | null;
  disabled?: boolean;
  verified?: boolean;
}

export interface PartnerMember extends PBRecord {
  partner: string;
  user: string;
  role_in_partner: string;
}

export interface Referral extends PBRecord {
  partner: string | null;
  referral_code: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  client_address: string | null;
  service: string | null;
  service_type: string | null;
  status: string;
  stage_date: string;
  estimated_value: number | null;
  final_value: number | null;
  active_subscription: boolean;
  odo_opportunity_id: number | null;
  odo_customer_id: number | null;
  odo_sale_id: number | null;
  odoo_sync_status: string;
  source: string;
  self_referral: boolean;
  notes: string | null;
  partner_commission_alta: number | null;
  partner_commission_recurrente: number | null;
}

export interface ReferralEvent extends PBRecord {
  referral: string;
  from_status: string | null;
  to_status: string;
  reason: string | null;
  lost_reason: string | null;
}

export interface WalletEntry extends PBRecord {
  partner: string;
  referral: string | null;
  type: string;
  amount: number;
  period: string | null;
  status: string;
  description: string | null;
}

export interface Payout extends PBRecord {
  partner: string;
  amount: number;
  invoice_reference: string | null;
  invoice_received_at: string | null;
  status: string;
  paid_at: string | null;
  odo_vendor_bill_id: number | null;
}

export interface Notification extends PBRecord {
  title: string;
  body: string | null;
  image: string | null;
  audience: string;
  channel: string;
  scheduled_at: string | null;
  sent_at: string | null;
  status: string;
}

export interface NotificationDelivery extends PBRecord {
  notification: string;
  user: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface DocumentItem extends PBRecord {
  title: string;
  type: string | null;
  category: string | null;
  file: string | null;
  version: string | null;
  published: boolean;
}

export interface Service extends PBRecord {
  code: string;
  name: string;
  category: string;
  sector: string;
  alta_fee: number | null;
  monthly_fee: number | null;
  iva_included: boolean;
  active: boolean;
}

export interface Settings extends PBRecord {
  min_payout: number | null;
  payout_days: number | null;
  default_fixed_commission: number | null;
  default_recurring_rate: number | null;
  recurring_enabled: boolean;
  invoice_concept: string | null;
  sla_days_no_contact: number | null;
  sign_config?: unknown;
}

export interface OutboxEvent extends PBRecord {
  entity: string;
  entity_id: string;
  action: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
}

export interface CommissionRule extends PBRecord {
  name: string;
  profile: string;
  kind: string;
  service: string | null;
  fixed_amount: number | null;
  rate: number | null;
  base: string | null;
  allow_recurring: boolean;
  active: boolean;
}

export interface AdminAuditRecord extends PBRecord {
  actor: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  payload: unknown;
  ip: string | null;
}
