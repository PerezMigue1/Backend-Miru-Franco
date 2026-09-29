import type { Request } from 'express';
import { AUTH_COOKIE_NAME } from '../auth-cookie';
import { ExtractJwtFromRequest } from './jwt.strategy';

function req(parcial: Partial<Request> & { cookies?: Record<string, string> }): Request & Record<string, any> {
  return { headers: {}, ...parcial } as Request & Record<string, any>;
}

describe('ExtractJwtFromRequest', () => {
  it('lee el JWT de la cookie httpOnly del frontend web', () => {
    const r = req({ cookies: { [AUTH_COOKIE_NAME]: 'jwt-cookie' } });
    expect(ExtractJwtFromRequest(r)).toBe('jwt-cookie');
    expect(r.rawToken).toBe('jwt-cookie'); // logout / oauth/code revocan este token
    expect(r.authTransport).toBe('cookie');
  });

  it('prioriza Authorization: Bearer (integraciones)', () => {
    const r = req({
      headers: { authorization: 'Bearer jwt-header' },
      cookies: { [AUTH_COOKIE_NAME]: 'jwt-cookie' },
    });
    expect(ExtractJwtFromRequest(r)).toBe('jwt-header');
    expect(r.authTransport).toBe('bearer');
  });

  it('sin header ni cookie no hay token', () => {
    const r = req({});
    expect(ExtractJwtFromRequest(r)).toBeNull();
    expect(r.rawToken).toBeUndefined();
  });
});
