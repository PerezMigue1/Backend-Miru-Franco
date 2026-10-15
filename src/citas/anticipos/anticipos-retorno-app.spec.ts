import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { MercadoPagoClient } from '../../ecommerce/mercadopago/mercadopago.client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnticiposCitasController, RetornoAppAnticipoController } from './anticipos-citas.controller';
import { AnticiposCitasService } from './anticipos-citas.service';
import { DEEP_LINK_ANTICIPO_APP } from './anticipos.util';

/**
 * Regreso a la app después de pagar el anticipo: con ?origen=app la preferencia manda a Mercado Pago de
 * vuelta al backend, que redirige al deep link fijo. Sin origen=app, la preferencia queda como en la web.
 */

const FRONTEND = 'https://web.falsa.example';
const BACKEND = 'https://api.falsa.example';
const WEB = `${FRONTEND}/cliente/servicios-citas/confirmacion?citaId=7`;
const RETORNO = `${BACKEND}/api/pagos-en-linea/citas/retorno-app?citaId=7`;

const envOriginal = { FRONTEND_URL: process.env.FRONTEND_URL, BACKEND_URL: process.env.BACKEND_URL };
function restaurarEnv(nombre: keyof typeof envOriginal) {
  if (envOriginal[nombre] === undefined) delete process.env[nombre];
  else process.env[nombre] = envOriginal[nombre];
}

/** Sesión falsa: con Authorization es la dueña de la cita; sin él, 403 (así se ve que retorno-app no lo usa). */
const sesion: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers.authorization) return false;
    req.user = { id: 'cliente-yo' };
    return true;
  },
};

describe('Anticipo: regreso a la app después de pagar', () => {
  let app: INestApplication;
  let base: string;
  const mp = { crearPreferencia: jest.fn() };
  const prisma = {
    cita: {
      findUnique: jest.fn(async () => ({
        id: 7,
        clienteId: 'cliente-yo',
        estado: 'pendiente',
        anticipoRequerido: new Prisma.Decimal(150),
        anticipoPagadoEn: null,
        anticipoVenceEn: new Date(Date.now() + 60 * 60 * 1000),
        servicio: { id: 5, nombre: 'Nanoplastia' },
      })),
    },
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = FRONTEND;
    process.env.BACKEND_URL = `${BACKEND}/`;
    const modulo = await Test.createTestingModule({
      controllers: [AnticiposCitasController, RetornoAppAnticipoController],
      providers: [
        AnticiposCitasService,
        { provide: PrismaService, useValue: prisma },
        { provide: MercadoPagoClient, useValue: mp },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesion)
      .overrideGuard(PermisosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    mp.crearPreferencia.mockReset().mockResolvedValue({ id: 'pref-1', init_point: 'https://mp.test/pagar' });
  });

  afterAll(async () => {
    await app.close();
    restaurarEnv('FRONTEND_URL');
    restaurarEnv('BACKEND_URL');
  });

  async function preferencia(query = '') {
    const r = await fetch(`${base}/api/pagos-en-linea/citas/7/preferencia${query}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-falso' },
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ initPoint: 'https://mp.test/pagar' });
    expect(mp.crearPreferencia).toHaveBeenCalledTimes(1);
    return mp.crearPreferencia.mock.calls[0][0];
  }

  const retorno = (query: string) => fetch(`${base}/api/pagos-en-linea/citas/retorno-app${query}`, { redirect: 'manual' });

  describe('Preferencia', () => {
    it.each([
      ['sin origen', ''],
      ['origen=web', '?origen=web'],
      ['origen=APP', '?origen=APP'],
      ['origen repetido', '?origen=app&origen=app'],
    ])('%s: back_urls de la web, como siempre', async (_caso, query) => {
      const cuerpo = await preferencia(query);
      expect(cuerpo.back_urls).toEqual({ success: WEB, failure: WEB, pending: WEB });
      expect(cuerpo.auto_return).toBe('approved');
    });

    it('origen=app: las tres back_urls van a retorno-app en el backend y conserva auto_return', async () => {
      const cuerpo = await preferencia('?origen=app');
      expect(cuerpo.back_urls).toEqual({ success: RETORNO, failure: RETORNO, pending: RETORNO });
      expect(cuerpo.auto_return).toBe('approved');
      expect(cuerpo.external_reference).toBe('dev-cita-7');
    });
  });

  describe('GET retorno-app (pública)', () => {
    it('sin sesión: 302 al deep link exacto', async () => {
      const r = await retorno('?citaId=7');
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('appmirufranco://anticipo/7?retorno=mp');
      expect(r.headers.get('location')!.startsWith(`${DEEP_LINK_ANTICIPO_APP}/`)).toBe(true);
    });

    it('los parámetros que agrega Mercado Pago no aparecen en el Location', async () => {
      const extra = new URLSearchParams({
        collection_id: '123456',
        collection_status: 'approved',
        payment_id: '123456',
        status: 'approved',
        external_reference: 'cita-7',
        preference_id: 'pref-1',
        redirect: 'https://malo.example',
      });
      const r = await retorno(`?citaId=7&${extra.toString()}`);
      expect(r.status).toBe(302);
      const location = r.headers.get('location') ?? '';
      expect(location).toBe('appmirufranco://anticipo/7?retorno=mp');
      for (const valor of ['123456', 'approved', 'pref-1', 'malo.example', 'collection', 'payment']) {
        expect(location).not.toContain(valor);
      }
    });

    it.each([
      ['sin citaId', ''],
      ['vacío', '?citaId='],
      ['cero', '?citaId=0'],
      ['negativo', '?citaId=-7'],
      ['decimal', '?citaId=7.5'],
      ['con ceros a la izquierda', '?citaId=007'],
      ['texto', '?citaId=abc'],
      ['con ruta', '?citaId=7%2F..%2Fauth'],
      ['URL', `?citaId=${encodeURIComponent('https://malo.example')}`],
      ['repetido', '?citaId=7&citaId=8'],
      ['demasiado grande', '?citaId=99999999999999999999'],
    ])('citaId inválido (%s): 400 sin Location', async (_caso, query) => {
      const r = await retorno(query);
      expect(r.status).toBe(400);
      expect(r.headers.get('location')).toBeNull();
    });
  });
});
