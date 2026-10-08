/**
 * Gestió de la sessió del partner al portal (F3).
 * El token JWT de Directus es guarda a localStorage i s'envia a l'API.
 */

const TOKEN_KEY = 'polser_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage no disponible (privat/incògnit): ignorem
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignorem
  }
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}

/**
 * Marca de temps (ms) de caducitat del JWT de sessió, o `null` si no es pot
 * llegir. Serveix per refrescar proactivament abans que caduqui.
 */
export function tokenExpiresAt(): number | null {
  const token = getToken();
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}