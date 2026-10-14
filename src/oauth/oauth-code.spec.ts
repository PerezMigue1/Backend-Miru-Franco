import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { OauthController } from './oauth.controller';
import { OauthService } from './oauth.service';

/**
 * POST /api/oauth/code: la página /oauth/alexa manda { redirect_uri, state, client_id? }. El backend valida
 * redirect_uri (y client_id si llega) contra ALEXA_REDIRECT_URIS / ALEXA_CLIENT_ID antes de emitir el código
 * y devuelve el destino validado; la web solo redirige a ese destino.
 */
const PERMITIDA = 'https://layla.amazon.com/api/skill/link/M2AAAAAAAAAAAA';
const CONFIG: Record<string, string> = {
  ALEXA_CLIENT_ID: 'cliente-alexa',
  ALEXA_REDIRECT_URIS: `${PERMITIDA}, https://pitangui.amazon.com/api/skill/link/M2AAAAAAAAAAAA`,
};

/** El JwtAuthGuard real necesita un JWT firmado: aquí la empleada ya llega autenticada. */
const guardFalso: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = { id: 'est-1', rol: 'estilista' };
    req.rawToken = 'jwt-de-la-empleada';
    return true;
  },
};

describe('POST /api/oauth/code', () => {
  let app: INestApplication;
  let base: string;
  const prisma = {
    usuario: { findUnique: jest.fn(async () => ({ rol: 'estilista', activo: true })) },
    codigoOAuth: { create: jest.fn(async () => ({})) },
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [OauthController],
      providers: [
        OauthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k] } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const pedir = (cuerpo: unknown) =>
    fetch(`${base}/api/oauth/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  it('con redirect_uri autorizada y state (lo que manda la web): 200 con el código y el destino validado', async () => {
    const res = await pedir({ redirect_uri: PERMITIDA, state: 'abc' });
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual({ success: true, code: expect.any(String), redirectUri: PERMITIDA });
    expect(prisma.codigoOAuth.create).toHaveBeenCalledTimes(1);
  });

  it('con client_id correcto también: 200', async () => {
    const res = await pedir({ redirect_uri: PERMITIDA, state: 'abc', client_id: 'cliente-alexa' });
    expect(res.status).toBe(200);
  });

  it.each([
    ['redirect_uri ajena', { redirect_uri: 'https://atacante.example/robar', state: 'abc' }],
    ['sin redirect_uri', { state: 'abc' }],
    ['client_id incorrecto', { redirect_uri: PERMITIDA, state: 'abc', client_id: 'otro' }],
  ])('%s: 400 y no se emite código', async (_caso, cuerpo) => {
    const res = await pedir(cuerpo);
    expect(res.status).toBe(400);
    expect(prisma.codigoOAuth.create).not.toHaveBeenCalled();
  });
});
