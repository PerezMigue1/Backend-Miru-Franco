import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { PagosEnLineaController, RetornoAppPedidoController } from '../ecommerce/mercadopago/pagos-en-linea.controller';
import { PagosEnLineaService } from '../ecommerce/mercadopago/pagos-en-linea.service';
import { AnticiposCitasController, RetornoAppAnticipoController } from '../citas/anticipos/anticipos-citas.controller';
import { AnticiposCitasService } from '../citas/anticipos/anticipos-citas.service';
import { UsuariosService } from '../usuarios/usuarios.service';

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsuariosController } = require('../usuarios/usuarios.controller');

/**
 * Contrato con la app móvil ACTUAL (otro proyecto, no cambia en esta ronda): lo que manda y lo que espera recibir
 * en el registro y en los pagos con Mercado Pago. Si una de estas pruebas falla, la app publicada deja de funcionar
 * entre el deploy y su nueva versión.
 */
describe('Contrato con la app móvil actual', () => {
  let app: INestApplication;
  let base: string;
  const usuarios = { crearUsuario: jest.fn() };
  const pagos = { crearPreferencia: jest.fn(), consultarEstado: jest.fn() };
  const anticipos = { crearPreferencia: jest.fn(), consultarEstado: jest.fn() };
  const sesion: CanActivate = {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      if (req.headers.authorization === 'Bearer token-de-la-app') req.user = { id: 'clienta-app', rol: 'cliente' };
      return Boolean(req.user) || req.method === 'GET' && String(req.url).includes('retorno-app');
    },
  };
  const opcional: CanActivate = { canActivate: () => true };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [UsuariosController, PagosEnLineaController, RetornoAppPedidoController, AnticiposCitasController, RetornoAppAnticipoController],
      providers: [
        { provide: UsuariosService, useValue: usuarios },
        { provide: PagosEnLineaService, useValue: pagos },
        { provide: AnticiposCitasService, useValue: anticipos },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(sesion)
      .overrideGuard(PermisosGuard).useValue(opcional)
      .overrideGuard(SesionOpcionalGuard).useValue(opcional)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const pedir = (metodo: string, ruta: string, cuerpo?: unknown) =>
    fetch(`${base}/api${ruta}`, {
      method: metodo,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-de-la-app' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  it('registro con el cuerpo de la app (sin aceptaTerminos, con aceptaAvisoPrivacidad): se acepta', async () => {
    usuarios.crearUsuario.mockResolvedValue({ success: true, data: { id: 'u-app' } });
    const r = await pedir('POST', '/usuarios/registro', {
      nombre: 'Clienta App',
      email: 'clienta.app@example.com',
      telefono: '7710000000',
      // Valor ficticio armado aquí, con el formato que exige el DTO (no es una contraseña real).
      password: ['Prueba', 'Formato', '47'].join('$'),
      preguntaSeguridad: { pregunta: '¿Color favorito?', respuesta: 'azul' },
      aceptaAvisoPrivacidad: true,
    });
    expect(r.status).toBeLessThan(300);
    expect(usuarios.crearUsuario).toHaveBeenCalledTimes(1);
    expect(usuarios.crearUsuario.mock.calls[0][0]).not.toHaveProperty('aceptaTerminos');
  });

  it('preferencia del pedido: POST { pedidoId } con ?origen=app devuelve { initPoint } y avisa al servicio que es la app', async () => {
    pagos.crearPreferencia.mockResolvedValue({ initPoint: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1' });
    const r = await pedir('POST', '/pagos-en-linea/mercadopago/preferencia?origen=app', { pedidoId: 42 });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ initPoint: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1' });
    expect(pagos.crearPreferencia).toHaveBeenCalledWith(42, 'clienta-app', expect.any(Date), true);
  });

  it('estado del pedido: GET /estado/:id responde { estado, pedidoEstado }', async () => {
    pagos.consultarEstado.mockResolvedValue({ estado: 'aprobado', pedidoEstado: 'pagado' });
    const r = await pedir('GET', '/pagos-en-linea/mercadopago/estado/42');
    expect(await r.json()).toEqual({ estado: 'aprobado', pedidoEstado: 'pagado' });
  });

  it('preferencia del anticipo: POST /pagos-en-linea/citas/:id/preferencia?origen=app devuelve { initPoint }', async () => {
    anticipos.crearPreferencia.mockResolvedValue({ initPoint: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=2' });
    const r = await pedir('POST', '/pagos-en-linea/citas/7/preferencia?origen=app', {});
    expect(await r.json()).toEqual({ initPoint: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=2' });
    expect(anticipos.crearPreferencia).toHaveBeenCalledWith(7, 'clienta-app', expect.any(Date), true);
  });

  it('estado del anticipo: GET /pagos-en-linea/citas/:id/estado conserva los campos que lee la app', async () => {
    const respuesta = {
      estado: 'aprobado',
      citaEstado: 'confirmada',
      anticipoRequerido: 150,
      anticipoVenceEn: '2026-10-16T20:00:00.000Z',
      anticipoPagadoEn: '2026-10-16T18:10:00.000Z',
      anticipoEnSalon: false,
      cancelacion: null,
    };
    anticipos.consultarEstado.mockResolvedValue(respuesta);
    const r = await pedir('GET', '/pagos-en-linea/citas/7/estado');
    expect(await r.json()).toEqual(respuesta);
  });

  it.each([
    ['/pagos-en-linea/mercadopago/retorno-app?pedidoId=42&payment_id=1&status=approved', 'appmirufranco://pedido/42?retorno=mp'],
    ['/pagos-en-linea/citas/retorno-app?citaId=7&payment_id=1&status=approved', 'appmirufranco://anticipo/7?retorno=mp'],
  ])('regreso de Mercado Pago a la app (%s): 302 al mismo deep link de siempre', async (ruta, deepLink) => {
    const r = await fetch(`${base}/api${ruta}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(deepLink);
  });
});
