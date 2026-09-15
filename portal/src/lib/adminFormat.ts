/** Etiquetes i formatejadors del panell d'administració (en català). */

export const fmtEuro = (n: number | null | undefined): string =>
  new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(n || 0));

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const PARTNER_STATUS: Record<string, string> = {
  pendente: 'Pendent',
  actiu: 'Actiu',
  inactiu: 'Inactiu',
  bloquejat: 'Bloquejat',
};

export const PARTNER_STATUS_TONE: Record<string, string> = {
  pendente: 'amber',
  actiu: 'green',
  inactiu: 'gray',
  bloquejat: 'red',
};

export const PROFILE_LABEL: Record<string, string> = {
  afiliat: 'Afiliat',
  colaborador: 'Col·laborador',
};

export const PARTNER_TYPE: Record<string, string> = {
  inmobiliaria: 'Inmobiliària',
  administrador_fincas: 'Administrador de finques',
  operador_telecom: 'Operador de telecom',
  autonomo: 'Autònom',
  otro: 'Altres',
};

export const CONTRACT_STATUS: Record<string, string> = {
  no: 'No generat',
  generating: 'Generant…',
  pending_signature: 'Pendent de signatura',
  signed: 'Signat',
  canceled: 'Cancel·lat',
  error: 'Error',
};

export const REFERRAL_STATUS: Record<string, string> = {
  lead: 'Nou',
  contactado: 'Contactat',
  presupuesto: 'Pressupost',
  aceptado: 'Acceptat',
  instalado: 'Instal·lat',
  perdido: 'Perdut',
};

export const REFERRAL_STATUS_TONE: Record<string, string> = {
  lead: 'blue',
  contactado: 'blue',
  presupuesto: 'amber',
  aceptado: 'amber',
  instalado: 'green',
  perdido: 'red',
};

export const REFERRAL_STATUS_ORDER = ['lead', 'contactado', 'presupuesto', 'aceptado', 'instalado', 'perdido'];

export const USER_ROLE: Record<string, string> = {
  partner: 'Partner',
  POLSER_cpso: 'POLSER CPSO',
  POLSER_admin: 'POLSER Admin',
  POLSER_ceo: 'POLSER CEO',
};

export const NOTIFICATION_STATUS: Record<string, string> = {
  draft: 'Esborrany',
  queued: 'En cua',
  sent: 'Enviada',
  failed: 'Fallida',
};

export const AUDIENCE: Record<string, string> = {
  all: 'Tothom',
  afiliats: 'Afiliats',
  colaboradors: 'Col·laboradors',
};

export const CHANNEL: Record<string, string> = {
  inapp: 'In-app',
  push: 'Push',
  both: 'In-app + Push',
};

export const PAYOUT_STATUS: Record<string, string> = {
  solicitada: 'Sol·licitada',
  factura_rebuda: 'Factura rebuda',
  en_proces: 'En procés',
  pagada: 'Pagada',
};

export const LEDGER_TYPE: Record<string, string> = {
  high: 'Alta',
  recurring: 'Recurrent',
  adjustment: 'Ajust',
  payout_deduction: 'Descompte retirada',
  reversal: 'Reversió',
};

export const LEDGER_STATUS: Record<string, string> = {
  accrued: 'Meritada',
  poised: 'Disponible',
  paid: 'Pagada',
  reversed: 'Revertida',
  void: 'Anul·lada',
};

export const OUTBOX_STATUS: Record<string, string> = {
  pending: 'Pendent',
  ok: 'Correcte',
  error: 'Error',
  dead: 'Mort',
};
