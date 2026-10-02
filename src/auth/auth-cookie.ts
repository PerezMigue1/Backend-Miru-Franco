import type { CookieOptions, Request, Response } from 'express';
import { VENTANA_REFRESH_SEGUNDOS } from './jwt-ttl';

/**
 * Sesión del frontend web en cookie httpOnly (el JWT deja de ser legible desde JavaScript).
 *
 * Contrato con el frontend (miru-franco-web, services/client.ts):
 * - El frontend envía `X-Auth-Mode: cookie` en login y exchange-code → el backend responde
 *   con `Set-Cookie` y SIN `token` en el cuerpo. En su lugar va `renovarEnSegundos`:
 *   el frontend solo llama a refresh cuando le quedan menos de 5 min.
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

function leerPayload(token: string): { exp?: unknown; iat?: unknown; lastActivity?: unknown } | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Milisegundos hasta el `exp` del JWT, para que la cookie no sobreviva al token. */
function msHastaExpirar(token: string): number | undefined {
  const payload = leerPayload(token);
  return typeof payload?.exp === 'number' ? Math.max(0, payload.exp * 1000 - Date.now()) : undefined;
}

/**
 * Segundos que le quedan a este token para que /auth/refresh lo acepte: su ventana de renovación
 * (VENTANA_REFRESH_SEGUNDOS desde `lastActivity`), sin pasar del `exp`. El frontend no puede leer
 * la cookie httpOnly, así que renueva con este dato y no en cada carga. Va como duración y no como
 * hora para que un reloj desfasado en el dispositivo no lo descuadre.
 */
export function renovarEnSegundos(token: string, ahoraMs: number = Date.now()): number | undefined {
  const payload = leerPayload(token);
  if (typeof payload?.exp !== 'number') return undefined;
  const desde = typeof payload.lastActivity === 'number' ? payload.lastActivity : payload.iat;
  const limite = typeof desde === 'number' ? Math.min(payload.exp, desde + VENTANA_REFRESH_SEGUNDOS) : payload.exp;
  return Math.max(0, limite - Math.floor(ahoraMs / 1000));
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
 * Entrega un token recién emitido según el modo del cliente: como cookie httpOnly (sin `token`
 * en el cuerpo, con `renovarEnSegundos`) o en el cuerpo, como antes.
 */
export function entregarSesion<T extends { token?: string }>(
  res: Response,
  resultado: T,
  enCookie: boolean,
): T | (Omit<T, 'token'> & { renovarEnSegundos?: number }) {
  if (!enCookie || !resultado?.token) return resultado;
  setAuthCookie(res, resultado.token);
  const { token, ...sinToken } = resultado;
  return { ...sinToken, renovarEnSegundos: renovarEnSegundos(token) };
}
