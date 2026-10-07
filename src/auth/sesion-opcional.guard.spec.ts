import { Controller, INestApplication, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { SesionOpcionalGuard } from './sesion-opcional.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityService } from '../common/services/security.service';

/** El guard real con la JwtStrategy real: nunca rechaza; solo con un JWT válido deja req.user. */

const SECRETO = 'secreto-falso-solo-para-pruebas';

@Controller('prueba')
class PruebaController {
  @Post('registro')
  @UseGuards(SesionOpcionalGuard)
  registro(@Req() req: any) {
    return { usuario: req.user ?? null };
  }
}

describe('SesionOpcionalGuard (POST /usuarios/registro)', () => {
  let app: INestApplication;
  let base: string;
  const seguridad = {
    isTokenRevoked: jest.fn(async () => false),
    isTokenRevokedByGlobalLogout: jest.fn(async () => false),
    isUserInactive: jest.fn(async () => false),
    updateLastActivity: jest.fn(async () => undefined),
  };
  const prisma = { usuario: { findUnique: jest.fn(async () => ({ rol: 'admin' })) } };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [PruebaController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: SecurityService, useValue: seguridad },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO : undefined) } },
      ],
    }).compile();
    app = modulo.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const ahora = () => Math.floor(Date.now() / 1000);
  const firmar = (extra: Record<string, unknown> = {}, secreto = SECRETO, expiresIn = 600) =>
    jwt.sign({ id: 'admin-1', email: 'admin@example.com', iat: ahora(), lastActivity: ahora(), ...extra }, secreto, { expiresIn });
  const pedir = async (headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}/api/prueba/registro`, { method: 'POST', headers });
    return { status: r.status, cuerpo: await r.json() };
  };

  it('sin token: pasa como anónima', async () => {
    expect(await pedir()).toEqual({ status: 201, cuerpo: { usuario: null } });
  });

  it('con un token mal firmado, vencido o basura: pasa como anónima (no 401)', async () => {
    expect((await pedir({ Authorization: `Bearer ${firmar({}, 'otro-secreto-falso')}` })).cuerpo.usuario).toBeNull();
    expect((await pedir({ Authorization: `Bearer ${firmar({}, SECRETO, -10)}` })).cuerpo.usuario).toBeNull();
    expect((await pedir({ Authorization: 'Bearer no-es-un-jwt' })).cuerpo.usuario).toBeNull();
  });

  it('con un token revocado o una sesión vencida por inactividad: anónima', async () => {
    seguridad.isTokenRevoked.mockResolvedValueOnce(true);
    expect((await pedir({ Authorization: `Bearer ${firmar()}` })).cuerpo.usuario).toBeNull();
    seguridad.isUserInactive.mockResolvedValueOnce(true);
    expect((await pedir({ Authorization: `Bearer ${firmar()}` })).cuerpo.usuario).toBeNull();
  });

  it('con un JWT válido (Bearer o cookie de la web): deja el usuario con su rol de la base', async () => {
    expect((await pedir({ Authorization: `Bearer ${firmar()}` })).cuerpo.usuario).toMatchObject({ id: 'admin-1', rol: 'admin' });
    expect((await pedir({ Cookie: `mf_session=${firmar()}` })).cuerpo.usuario).toMatchObject({ id: 'admin-1', rol: 'admin' });
  });
});
