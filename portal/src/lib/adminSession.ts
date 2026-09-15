/**
 * Sessió del panell d'administració (/admin).
 *
 * El token és el d'un SUPERUSUARI de PocketBase. Per minimitzar el risc
 * (XSS/robatori de token) es guarda a `sessionStorage` (s'esborra en
 * tancar la pestanya) amb una clau pròpia, TOTALMENT separada del token
 * del portal de partners (`polser_token`, a `session.ts`). Així un
 * logout/error del panell mai afecta la sessió del partner.
 */

const TOKEN_KEY = 'polser_admin_token';
const EMAIL_KEY = 'polser_admin_email';

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAdminEmail(): string | null {
  try {
    return sessionStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

export function setAdminSession(token: string, email: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EMAIL_KEY, email);
  } catch {
    // sessionStorage no disponible: ignorem
  }
}

export function clearAdminSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  } catch {
    // ignorem
  }
}

export function isAdminAuthenticated(): boolean {
  return Boolean(getAdminToken());
}
