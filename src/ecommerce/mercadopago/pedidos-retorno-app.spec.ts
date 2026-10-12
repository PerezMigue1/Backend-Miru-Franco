import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { EstadoPedido, Prisma } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { DEEP_LINK_PEDIDO_APP } from '../../citas/anticipos/anticipos.util';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { METODO_PAGO_MERCADOPAGO } from '../pedidos/flujo-pedido';
import { MercadoPagoClient } from './mercadopago.client';
import { PagosEnLineaController, RetornoAppPedidoController } from './pagos-en-linea.controller';
import { PagosEnLineaService } from './pagos-en-linea.service';

/**
 * Regreso a la app después de pagar un pedido: con ?origen=app la preferencia manda a Mercado Pago de
 * vuelta al backend, que redirige al deep link fijo. Sin origen=app, la preferencia queda como en la web.
 */

const FRONTEND = 'https://web.falsa.example';
const BACKEND = 'https://api.falsa.example';
const WEB = `${FRONTEND}/cliente/tienda-online/confirmacion?pedidoId=42`;
const RETORNO = `${BACKEND}/api/pagos-en-linea/mercadopago/retorno-app?pedidoId=42`;

const envOriginal = { FRONTEND_URL: process.env.FRONTEND_URL, BACKEND_URL: process.env.BACKEND_URL };
function restaurarEnv(nombre: keyof typeof envOriginal) {
  if (envOriginal[nombre] === undefined) delete process.env[nombre];
  else process.env[nombre] = envOriginal[nombre];
}

/** Sesión falsa: con Authorization es la dueña del pedido; sin él, 403 (así se ve que retorno-app no lo usa). */
const sesion: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.headers.authorization) return false;
    req.user = { id: 'cliente-yo' };
    return true;
  },
};

describe('Pedido: regreso a la app después de pagar', () => {
  let app: INestApplication;
  let base: string;
  const mp = { crearPreferencia: jest.fn() };
  const prisma = {
    pedido: {
      findUnique: jest.fn(async () => ({
        id: 42,
        usuarioId: 'cliente-yo',
        metodoPago: METODO_PAGO_MERCADOPAGO,
        estado: EstadoPedido.pendiente_pago,
        creadoEn: new Date(Date.now() - 60 * 60 * 1000),
        total: new Prisma.Decimal(300),
        items: [{ presentacionId: 7, cantidad: 2, precioUnitario: new Prisma.Decimal(150), nombreProducto: 'Shampoo', tamanio: '250 ml' }],
      })),
    },
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = FRONTEND;
    process.env.BACKEND_URL = `${BACKEND}/`;
    const modulo = await Test.createTestingModule({
      controllers: [PagosEnLineaController, RetornoAppPedidoController],
      providers: [
        PagosEnLineaService,
        { provide: PrismaService, useValue: prisma },
        { provide: EcommerceAccessService, useValue: { getRol: jest.fn() } },
        { provide: MercadoPagoClient, useValue: mp },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesion)
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
    const r = await fetch(`${base}/api/pagos-en-linea/mercadopago/preferencia${query}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-falso', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId: 42 }),
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ initPoint: 'https://mp.test/pagar' });
    expect(mp.crearPreferencia).toHaveBeenCalledTimes(1);
    return mp.crearPreferencia.mock.calls[0][0];
  }

  const retorno = (query: string) => fetch(`${base}/api/pagos-en-linea/mercadopago/retorno-app${query}`, { redirect: 'manual' });

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
      expect(cuerpo.external_reference).toBe('42');
    });
  });

  describe('GET retorno-app (pública)', () => {
    it('sin sesión: 302 al deep link exacto', async () => {
      const r = await retorno('?pedidoId=42');
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('appmirufranco://pedido/42?retorno=mp');
      expect(r.headers.get('location')!.startsWith(`${DEEP_LINK_PEDIDO_APP}/`)).toBe(true);
    });

    it('no marca nada como pagado: no consulta el pedido ni Mercado Pago', async () => {
      prisma.pedido.findUnique.mockClear();
      const r = await retorno('?pedidoId=42&status=approved&collection_status=approved');
      expect(r.status).toBe(302);
      expect(prisma.pedido.findUnique).not.toHaveBeenCalled();
      expect(mp.crearPreferencia).not.toHaveBeenCalled();
    });

    it('los parámetros que agrega Mercado Pago no aparecen en el Location', async () => {
      const extra = new URLSearchParams({
        collection_id: '123456',
        collection_status: 'approved',
        payment_id: '123456',
        status: 'approved',
        external_reference: '42',
        preference_id: 'pref-1',
        redirect: 'https://malo.example',
      });
      const r = await retorno(`?pedidoId=42&${extra.toString()}`);
      expect(r.status).toBe(302);
      const location = r.headers.get('location') ?? '';
      expect(location).toBe('appmirufranco://pedido/42?retorno=mp');
      for (const valor of ['123456', 'approved', 'pref-1', 'malo.example', 'collection', 'payment']) {
        expect(location).not.toContain(valor);
      }
    });

    it.each([
      ['sin pedidoId', ''],
      ['vacío', '?pedidoId='],
      ['cero', '?pedidoId=0'],
      ['negativo', '?pedidoId=-42'],
      ['decimal', '?pedidoId=42.5'],
      ['con ceros a la izquierda', '?pedidoId=042'],
      ['texto', '?pedidoId=abc'],
      ['con ruta', '?pedidoId=42%2F..%2Fauth'],
      ['URL', `?pedidoId=${encodeURIComponent('https://malo.example')}`],
      ['repetido', '?pedidoId=42&pedidoId=43'],
      ['demasiado grande', '?pedidoId=99999999999999999999'],
    ])('pedidoId inválido (%s): 400 sin Location', async (_caso, query) => {
      const r = await retorno(query);
      expect(r.status).toBe(400);
      expect(r.headers.get('location')).toBeNull();
    });
  });
});
