import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EstadoPedido } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { PedidosService } from './pedidos.service';
import { transicionPermitida } from './flujo-pedido';
import { EnviosController } from '../envios/envios.controller';
import { EnviosService } from '../envios/envios.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionesListener } from '../../notificaciones/notificaciones.listener';

jest.mock('../common/pedido-inventario.util', () => ({
  cantidadPorPresentacion: jest.fn(() => new Map()),
  decrementarStockPresentaciones: jest.fn(async () => undefined),
  incrementarStockPorLineas: jest.fn(async () => undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const inventario = require('../common/pedido-inventario.util');

const CLIENTA = 'clienta-1';
const STAFF = 'staff-1';

/** Prisma en memoria para un solo pedido; el rol 'empleado' tiene caja:escritura (personal). */
function montar(pedido: { estado: EstadoPedido; metodoPago?: string | null; usuarioId?: string; pagadoEn?: Date | null }) {
  const actual = { id: 7, usuarioId: CLIENTA, metodoPago: null, pagadoEn: null, ...pedido };
  const actualizaciones: Record<string, unknown>[] = [];
  const historial: Record<string, unknown>[] = [];
  const tx = {
    pedidoItem: { findMany: jest.fn(async () => [{ presentacionId: 1, cantidad: 2 }]) },
    pedido: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => (actualizaciones.push(data), { ...actual, ...data })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 99, ...data })),
    },
    historialEstadoPedido: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => historial.push(data)) },
  };
  const prisma = {
    pedido: { findUnique: jest.fn(async () => actual) },
    permisoRol: {
      findUnique: jest.fn(async ({ where }: { where: { rol: string } }) =>
        where.rol === 'empleado' ? { claves: ['caja:escritura'] } : { claves: [] },
      ),
    },
    productoPresentacion: {
      findUnique: jest.fn(async () => ({ productoId: 3, disponible: true, stock: 10, precio: 120, tamanio: '250 ml', producto: { nombre: 'Shampoo' } })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    getRol: jest.fn(async (id: string) => (id === STAFF ? 'empleado' : id === 'admin-1' ? 'admin' : 'cliente')),
    isAdmin: (rol: string | null) => rol === 'admin',
  };
  const eventos = { emit: jest.fn() };
  const servicio = new PedidosService(prisma as any, access as any, eventos as any);
  return { servicio, actualizaciones, historial, eventos, tx };
}

const item = [{ productoId: 3, presentacionId: 1, cantidad: 1 }];

describe('Pedidos para recoger en el salón: sin envío', () => {
  it('crear con dirección de envío o costo de envío responde 400', async () => {
    const { servicio } = montar({ estado: EstadoPedido.borrador });
    await expect(
      servicio.crear(CLIENTA, { items: item, direccionEnvioId: '2f1c3a52-0f3e-4d4b-9a51-7a3b1d0c9e11' } as any),
    ).rejects.toMatchObject({ status: 400 });
    await expect(servicio.crear(CLIENTA, { items: item, costoEnvio: 50 } as any)).rejects.toMatchObject({ status: 400 });
  });

  it('editar con dirección, texto de dirección o costo de envío responde 400 (también para admin)', async () => {
    const { servicio } = montar({ estado: EstadoPedido.pendiente_pago });
    for (const dto of [
      { direccionEnvioId: '2f1c3a52-0f3e-4d4b-9a51-7a3b1d0c9e11' },
      { direccionTextoCompleta: 'Calle 1' },
      { costoEnvio: 30 },
    ]) {
      await expect(servicio.actualizar(7, 'admin-1', dto as any)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('la clienta crea su pedido con pago al recoger como pendiente_pago, sin dirección', async () => {
    const { servicio, tx } = montar({ estado: EstadoPedido.borrador });
    await servicio.crear(CLIENTA, { items: item, estado: EstadoPedido.pendiente_pago, metodoPago: 'pago_en_salon' } as any);
    const data = (tx.pedido.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ estado: 'pendiente_pago', metodoPago: 'pago_en_salon', direccionEnvioId: null, costoEnvio: 0 });
  });

  it('la clienta no puede crear su pedido ya pagado (403) y nadie lo crea como enviado (400)', async () => {
    const { servicio } = montar({ estado: EstadoPedido.borrador });
    await expect(servicio.crear(CLIENTA, { items: item, estado: EstadoPedido.pagado } as any)).rejects.toMatchObject({ status: 403 });
    await expect(servicio.crear(STAFF, { items: item, estado: EstadoPedido.enviado } as any)).rejects.toMatchObject({ status: 400 });
  });
});

describe('Pedidos para recoger en el salón: transiciones', () => {
  const { pendiente_pago, pagado, preparando, listo_recoger, enviado, entregado, cancelado } = EstadoPedido;

  it.each([
    [pendiente_pago, pagado, 'tarjeta_credito'],
    [pagado, preparando, 'tarjeta_credito'],
    [preparando, listo_recoger, 'tarjeta_credito'],
    [listo_recoger, entregado, 'tarjeta_credito'],
    [pendiente_pago, preparando, 'pago_en_salon'],
    [preparando, listo_recoger, 'pago_en_salon'],
    [listo_recoger, entregado, 'pago_en_salon'],
    [listo_recoger, cancelado, 'pago_en_salon'],
    [enviado, entregado, 'efectivo'], // pedido anterior
  ])('el personal pasa de %s a %s (%s)', async (desde, hacia, metodoPago) => {
    const { servicio, actualizaciones } = montar({ estado: desde, metodoPago });
    await servicio.actualizar(7, STAFF, { estado: hacia });
    expect(actualizaciones[0]).toMatchObject({ estado: hacia });
  });

  it.each([
    [pagado, enviado, 'tarjeta_credito'],
    [preparando, enviado, 'pago_en_salon'],
    [pendiente_pago, preparando, 'tarjeta_credito'], // en línea: primero se paga
    [pendiente_pago, pagado, 'pago_en_salon'], // al recoger: se cobra al entregar
    [pagado, listo_recoger, 'tarjeta_credito'], // falta prepararlo
    [entregado, cancelado, 'tarjeta_credito'],
    [cancelado, pendiente_pago, 'tarjeta_credito'],
  ])('el personal NO pasa de %s a %s (%s): 400', async (desde, hacia, metodoPago) => {
    const { servicio, actualizaciones } = montar({ estado: desde, metodoPago });
    await expect(servicio.actualizar(7, STAFF, { estado: hacia })).rejects.toMatchObject({ status: 400 });
    expect(actualizaciones).toHaveLength(0);
  });

  it.each([[preparando, listo_recoger], [listo_recoger, entregado], [pendiente_pago, pagado]])(
    'la clienta no puede pasar su pedido de %s a %s: 403',
    async (desde, hacia) => {
      const { servicio, actualizaciones } = montar({ estado: desde, metodoPago: 'pago_en_salon' });
      await expect(servicio.actualizar(7, CLIENTA, { estado: hacia })).rejects.toMatchObject({ status: 403 });
      expect(actualizaciones).toHaveLength(0);
    },
  );

  it('la clienta cancela mientras está pendiente o pagado; se devuelve el stock y queda en el historial', async () => {
    for (const desde of [pendiente_pago, pagado]) {
      inventario.incrementarStockPorLineas.mockClear();
      const { servicio, historial, eventos } = montar({ estado: desde, metodoPago: 'tarjeta_debito' });
      await servicio.actualizar(7, CLIENTA, { estado: cancelado });
      expect(inventario.incrementarStockPorLineas).toHaveBeenCalledTimes(1);
      expect(historial[0]).toMatchObject({ estadoAnterior: desde, estadoNuevo: cancelado, origen: 'api.cancelar_clienta' });
      expect(eventos.emit).toHaveBeenCalledWith('pedido.cancelado', { pedidoId: 7, usuarioId: CLIENTA });
    }
  });

  it('la clienta ya no puede cancelar cuando el pedido está en preparación: 403', async () => {
    const { servicio } = montar({ estado: preparando, metodoPago: 'tarjeta_debito' });
    await expect(servicio.actualizar(7, CLIENTA, { estado: cancelado })).rejects.toMatchObject({ status: 403 });
  });

  it('la clienta no puede cambiar el método de pago (decide el flujo): se ignora', async () => {
    const { servicio, actualizaciones } = montar({ estado: listo_recoger, metodoPago: 'pago_en_salon' });
    await servicio.actualizar(7, CLIENTA, { metodoPago: 'tarjeta_credito', notasCliente: 'Paso a las 5' } as any);
    expect(actualizaciones[0]).not.toHaveProperty('metodoPago');
    expect(actualizaciones[0]).toMatchObject({ notasCliente: 'Paso a las 5' });
  });

  it('otra clienta no puede tocar el pedido: 403', async () => {
    const { servicio } = montar({ estado: pendiente_pago });
    await expect(servicio.actualizar(7, 'otra-clienta', { estado: cancelado })).rejects.toMatchObject({ status: 403 });
  });

  it('pasar a listo_recoger emite el aviso a la dueña del pedido', async () => {
    const { servicio, eventos } = montar({ estado: preparando, metodoPago: 'pago_en_salon' });
    await servicio.actualizar(7, STAFF, { estado: listo_recoger });
    expect(eventos.emit).toHaveBeenCalledWith('pedido.listo_recoger', { pedidoId: 7, usuarioId: CLIENTA });
  });

  it('cobrar y entregar un pago al recoger registra la fecha de pago', async () => {
    const { servicio, actualizaciones } = montar({ estado: listo_recoger, metodoPago: 'pago_en_salon' });
    await servicio.actualizar(7, STAFF, { estado: entregado });
    expect(actualizaciones[0].pagadoEn).toBeInstanceOf(Date);
  });

  it('la regla pura: nada llega a enviado', () => {
    for (const desde of Object.values(EstadoPedido)) {
      expect(transicionPermitida(desde, enviado, 'tarjeta_credito')).toBe(false);
      expect(transicionPermitida(desde, enviado, 'pago_en_salon')).toBe(false);
    }
  });
});

describe('Aviso "listo para recoger"', () => {
  it('se encola por app y por email con el texto para la clienta', async () => {
    const encolar = jest.fn(async () => ({ notificacionId: 'n1', envios: [{ id: 'e1' }, { id: 'e2' }] }));
    const resolverCanales = jest.fn(async (_u: string, _t: string, canales: string[]) =>
      canales.map((canal) => ({ canal, estado: 'pendiente' })),
    );
    const drenarInmediatas = jest.fn();
    const listener = new NotificacionesListener(
      { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as any,
      { encolar } as any,
      { resolverCanales } as any,
      { drenarInmediatas } as any,
    );

    await listener.onPedidoListoRecoger({ pedidoId: 7, usuarioId: CLIENTA });

    expect(resolverCanales).toHaveBeenCalledWith(CLIENTA, 'pedido_listo_recoger', ['in_app', 'email']);
    expect(encolar).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        usuarioId: CLIENTA,
        tipo: 'pedido_listo_recoger',
        titulo: 'Tu pedido está listo para recoger',
        canales: [
          { canal: 'in_app', estado: 'pendiente' },
          { canal: 'email', estado: 'pendiente' },
        ],
      }),
    );
    expect(drenarInmediatas).toHaveBeenCalledWith(['e1', 'e2']);
  });
});

describe('/api/envios: solo admin crea, edita o borra', () => {
  let app: INestApplication;
  let base: string;
  const envios = { crear: jest.fn(async () => ({ success: true })), actualizar: jest.fn(), eliminar: jest.fn(), listarPorPedido: jest.fn(async () => ({ success: true, data: [] })) };
  const prisma = {
    usuario: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ rol: where.id === 'admin-1' ? 'admin' : 'cliente' })) },
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [EnviosController],
      providers: [
        { provide: EnviosService, useValue: envios },
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { id: req.headers['x-usuario'] };
          return true;
        },
      })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = (metodo: string, ruta: string, usuario: string) =>
    fetch(`${base}/api/envios${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-usuario': usuario },
      body: metodo === 'GET' ? undefined : JSON.stringify({ pedidoId: 7 }),
    });

  it('una clienta recibe 403 al crear, editar o borrar, y el servicio no se llama', async () => {
    expect((await pedir('POST', '', CLIENTA)).status).toBe(403);
    expect((await pedir('PUT', '/1', CLIENTA)).status).toBe(403);
    expect((await pedir('DELETE', '/1', CLIENTA)).status).toBe(403);
    expect(envios.crear).not.toHaveBeenCalled();
    expect(envios.actualizar).not.toHaveBeenCalled();
    expect(envios.eliminar).not.toHaveBeenCalled();
  });

  it('la clienta sí puede leer los envíos de su pedido (historial) y el admin sí puede crear', async () => {
    expect((await pedir('GET', '/pedido/7', CLIENTA)).status).toBe(200);
    expect((await pedir('POST', '', 'admin-1')).status).toBe(201);
  });
});
