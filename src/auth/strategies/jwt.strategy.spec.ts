import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_COOKIE_NAME } from '../auth-cookie';
import { ExtractJwtFromRequest, JwtStrategy } from './jwt.strategy';

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

describe('JwtStrategy.validate: cuenta desactivada', () => {
  function estrategia(usuario: Record<string, unknown> | null) {
    const seguridad = {
      isTokenRevoked: jest.fn().mockResolvedValue(false),
      isTokenRevokedByGlobalLogout: jest.fn().mockResolvedValue(false),
      isUserInactive: jest.fn().mockResolvedValue(false),
      updateLastActivity: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = { usuario: { findUnique: jest.fn().mockResolvedValue(usuario) } };
    const s = new JwtStrategy({ get: () => 'secreto-falso-solo-para-pruebas' } as any, seguridad as any, prisma as any);
    return { s, prisma };
  }
  const payload = () => ({ id: 'u-1', email: 'p@example.com', iat: Math.floor(Date.now() / 1000), lastActivity: 1 });
  const peticion = { rawToken: 't' } as any;

  it('desactivar o eliminar (activo=false) corta la sesión: 401', async () => {
    const { s, prisma } = estrategia({ rol: 'estilista', activo: false });
    await expect(s.validate(peticion, payload())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' }, select: { rol: true, activo: true } });
  });

  it('la cuenta ya no existe: 401', async () => {
    const { s } = estrategia(null);
    await expect(s.validate(peticion, payload())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cuenta activa: sigue entrando con su rol', async () => {
    const { s } = estrategia({ rol: 'estilista', activo: true });
    await expect(s.validate(peticion, payload())).resolves.toMatchObject({ id: 'u-1', rol: 'estilista' });
  });
});
