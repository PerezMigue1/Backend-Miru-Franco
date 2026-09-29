import type { CookieOptions, Request, Response } from 'express';

/**
 * Sesión del frontend web en cookie httpOnly (el JWT deja de ser legible desde JavaScript).
 *
 * Contrato con el frontend (miru-franco-web, services/client.ts):
 * - El frontend envía `X-Auth-Mode: cookie` en login y exchange-code → el backend responde
 *   con `Set-Cookie` y SIN `token` en el cuerpo.
 * - Toda petición autenticada viaja con `credentials: 'include'`; JwtStrategy lee la cookie
 *   cuando no hay `Authorization: Bearer`.
 * - refresh responde como se autenticó la petición: cookie → nueva cookie (sin token en el
 *   cuerpo); Bearer → token en el cuerpo, como antes.
 * - logout / logout-all revocan el token y borran la cookie.
 * Clientes que no envían la cabecera (integraciones, scripts) siguen recibiendo el token en el
 * cuerpo y usando `Authorization: Bearer`.
 */
export const AUTH_COOKIE_NAME = 'mf_session';

export const AUTH_MODE_HEADER = 'x-auth-mode';

/**
 * SameSite=Strict: el frontend (www.mirufranco.com) y la API (api.mirufranco.com) son el mismo
 * "site", así que la cookie viaja en los fetch del frontend y nunca en peticiones de otros sitios.
 * `secure` solo en producción para que funcione en http://localhost durante desarrollo.
 */
function opcionesBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api',
  };
}

/** Milisegundos hasta el `exp` del JWT, para que la cookie no sobreviva al token. */
function msHastaExpirar(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload?.exp === 'number' ? Math.max(0, payload.exp * 1000 - Date.now()) : undefined;
  } catch {
    return undefined;
  }
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, { ...opcionesBase(), maxAge: msHastaExpirar(token) });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, opcionesBase());
}

export function leerTokenDeCookie(req: Request): string | null {
  const valor = (req as Request & { cookies?: Record<string, unknown> }).cookies?.[AUTH_COOKIE_NAME];
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** true si el cliente pidió la sesión solo como cookie (frontend web). */
export function pideSesionEnCookie(req: Request): boolean {
  return String(req.headers[AUTH_MODE_HEADER] ?? '').trim().toLowerCase() === 'cookie';
}

/**
 * Entrega un token recién emitido según el modo del cliente: como cookie httpOnly (y sin
 * `token` en el cuerpo) o en el cuerpo, como antes.
 */
export function entregarSesion<T extends { token?: string }>(
  res: Response,
  resultado: T,
  enCookie: boolean,
): T | Omit<T, 'token'> {
  if (!enCookie || !resultado?.token) return resultado;
  setAuthCookie(res, resultado.token);
  const { token: _token, ...sinToken } = resultado;
  return sinToken;
}
