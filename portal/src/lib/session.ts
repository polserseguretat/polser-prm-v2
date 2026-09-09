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