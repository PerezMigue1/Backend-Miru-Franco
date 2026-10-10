import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { EcommerceAccessService } from './ecommerce-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PedidoItemsController } from '../pedido-items/pedido-items.controller';
import { PedidoItemsService } from '../pedido-items/pedido-items.service';
import { PagosController } from '../pagos/pagos.controller';
import { PagosService } from '../pagos/pagos.service';
import { HistorialEstadoPedidoController } from '../historial-estado-pedido/historial-estado-pedido.controller';
import { HistorialEstadoPedidoService } from '../historial-estado-pedido/historial-estado-pedido.service';
import { EnviosController } from '../envios/envios.controller';
import { EnviosService } from '../envios/envios.service';

/**
 * Portal de clienta (`?propios=true`) en los subrecursos del pedido: como en GET /pedidos/:id?propios=true,
 * un pedido ajeno responde 404 para cualquier rol (también el admin). Sin el parámetro, todo sigue igual.
 */
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'adm-1': 'admin' };
const PEDIDOS = [{ id: 9, usuarioId: 'cli-1' }, { id: 10, usuarioId: 'otra' }];

function prismaFalso() {
  return {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async () => null) },
    pedido: { findUnique: jest.fn(async ({ where }: any) => PEDIDOS.find((p) => p.id === where.id) ?? null) },
    pedidoItem: { findMany: jest.fn(async () => []) },
    envio: { findMany: jest.fn(async () => []), findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, pedidoId: 10 })) },
    historialEstadoPedido: { findMany: jest.fn(async () => []), findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, pedidoId: 10 })) },
    pago: { findMany: jest.fn(async () => []) },
  } as any;
}

describe('Servicios de subrecursos con propios', () => {
  const montar = () => {
    const prisma = prismaFalso();
    const access = new EcommerceAccessService(prisma);
    return {
      items: new PedidoItemsService(prisma, access),
      historial: new HistorialEstadoPedidoService(prisma, access),
      envios: new EnviosService(prisma, access),
    };
  };

  it('pedido ajeno con propios: 404 aunque sea admin', async () => {
    const { items, historial, envios } = montar();
    await expect(items.listarPorPedido(10, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(historial.listarPorPedido(10, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(historial.obtenerPorId(4, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(envios.listarPorPedido(10, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(envios.obtenerPorId(4, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
  });

  it('sin propios el admin sigue viendo el pedido ajeno; con propios la dueña ve el suyo', async () => {
    const { items, envios } = montar();
    await expect(items.listarPorPedido(10, 'adm-1')).resolves.toMatchObject({ success: true });
    await expect(envios.listarPorPedido(9, 'cli-1', true)).resolves.toMatchObject({ success: true });
  });
});

describe('Controllers de subrecursos aceptan ?propios=true', () => {
  let app: INestApplication;
  let base: string;
  const prisma = prismaFalso();
  const items = { listarPorPedido: jest.fn(async () => ({ success: true })) };
  const pagos = { listarPorPedido: jest.fn(async () => ({ success: true })) };
  const historial = { listarPorPedido: jest.fn(async () => ({ success: true })), obtenerPorId: jest.fn(async () => ({ success: true })) };
  const envios = { listarPorPedido: jest.fn(async () => ({ success: true })), obtenerPorId: jest.fn(async () => ({ success: true })) };

  beforeAll(async () => {
    const jwt = { canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); req.user = { id: req.headers['x-usuario'] }; return true; } };
    const modulo = await Test.createTestingModule({
      controllers: [PedidoItemsController, PagosController, HistorialEstadoPedidoController, EnviosController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        EcommerceAccessService,
        { provide: PedidoItemsService, useValue: items },
        { provide: PagosService, useValue: pagos },
        { provide: HistorialEstadoPedidoService, useValue: historial },
        { provide: EnviosService, useValue: envios },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwt)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (ruta: string, usuario = 'adm-1') => fetch(`${base}/api/${ruta}`, { headers: { 'x-usuario': usuario } });

  it('items, historial y envíos reciben propios=true en el servicio', async () => {
    await get('pedidos/10/items?propios=true');
    await get('historial-estados-pedido/pedido/10?propios=true');
    await get('historial-estados-pedido/4?propios=true');
    await get('envios/pedido/10?propios=true');
    await get('envios/4?propios=true');
    expect(items.listarPorPedido).toHaveBeenCalledWith(10, 'adm-1', true);
    expect(historial.listarPorPedido).toHaveBeenCalledWith(10, 'adm-1', true);
    expect(historial.obtenerPorId).toHaveBeenCalledWith(4, 'adm-1', true);
    expect(envios.listarPorPedido).toHaveBeenCalledWith(10, 'adm-1', true);
    expect(envios.obtenerPorId).toHaveBeenCalledWith(4, 'adm-1', true);
  });

  it('pagos de un pedido ajeno con propios=true: 404 sin llegar al servicio; sin propios, pasa', async () => {
    expect((await get('pagos/pedido/10?propios=true')).status).toBe(404);
    expect(pagos.listarPorPedido).not.toHaveBeenCalled();
    expect((await get('pagos/pedido/9?propios=true', 'cli-1')).status).toBe(200);
    expect((await get('pagos/pedido/10')).status).toBe(200);
  });
});
