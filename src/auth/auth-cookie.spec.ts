import type { Request, Response } from 'express';
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  entregarSesion,
  leerTokenDeCookie,
  pideSesionEnCookie,
  renovarEnSegundos,
} from './auth-cookie';

function jwtCon(exp: number, extra: Record<string, number> = {}): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ id: 'u1', exp, ...extra })}.firma`;
}

function resMock() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

describe('auth-cookie', () => {
  it('en modo cookie pone una cookie httpOnly/SameSite=Strict y quita el token del cuerpo', () => {
    const res = resMock();
    const token = jwtCon(Math.floor(Date.now() / 1000) + 3600);

    const cuerpo = entregarSesion(res, { success: true, token, usuario: { id: 'u1' } }, true);

    expect(cuerpo).toEqual({ success: true, usuario: { id: 'u1' }, renovarEnSegundos: expect.any(Number) });
    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [nombre, valor, opciones] = res.cookie.mock.calls[0];
    expect(nombre).toBe(AUTH_COOKIE_NAME);
    expect(valor).toBe(token);
    expect(opciones).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api' });
    // La cookie no sobrevive al token (~1 h)
    expect(opciones.maxAge).toBeGreaterThan(3500 * 1000);
    expect(opciones.maxAge).toBeLessThanOrEqual(3600 * 1000);
  });

  it('renovarEnSegundos: lo que falta de los 15 min desde lastActivity, sin pasar del exp', () => {
    const ahora = 1_800_000_000;
    const ms = ahora * 1000;
    expect(renovarEnSegundos(jwtCon(ahora + 24 * 3600, { iat: ahora, lastActivity: ahora }), ms)).toBe(15 * 60);
    // Token a punto de expirar: manda el exp.
    expect(renovarEnSegundos(jwtCon(ahora + 60, { iat: ahora, lastActivity: ahora }), ms)).toBe(60);
    // Sin lastActivity, cuenta desde iat.
    expect(renovarEnSegundos(jwtCon(ahora + 24 * 3600, { iat: ahora - 600 }), ms)).toBe(300);
    // Ventana ya pasada: 0, nunca negativo.
    expect(renovarEnSegundos(jwtCon(ahora + 24 * 3600, { iat: ahora - 3600, lastActivity: ahora - 3600 }), ms)).toBe(0);
    expect(renovarEnSegundos('no-es-un-jwt', ms)).toBeUndefined();
  });

  it('sin modo cookie devuelve el token en el cuerpo y no toca cookies (clientes Bearer)', () => {
    const res = resMock();
    const resultado = { success: true, token: jwtCon(9999999999) };

    expect(entregarSesion(res, resultado, false)).toBe(resultado);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('clearAuthCookie borra la cookie con el mismo path', () => {
    const res = resMock();
    clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, expect.objectContaining({ path: '/api' }));
  });

  it('lee el token de la cookie y detecta la cabecera X-Auth-Mode', () => {
    const req = {
      cookies: { [AUTH_COOKIE_NAME]: 'abc' },
      headers: { 'x-auth-mode': 'Cookie' },
    } as unknown as Request;
    expect(leerTokenDeCookie(req)).toBe('abc');
    expect(pideSesionEnCookie(req)).toBe(true);
    expect(leerTokenDeCookie({ headers: {} } as Request)).toBeNull();
    expect(pideSesionEnCookie({ headers: {} } as Request)).toBe(false);
  });
});
