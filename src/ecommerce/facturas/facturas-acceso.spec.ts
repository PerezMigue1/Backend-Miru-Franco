import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { FacturasController } from './facturas.controller';
import { FacturasService } from './facturas.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Facturas: ids enteros consecutivos, así que el id no protege nada. La factura sin pedido (nota de
 * mostrador) es solo de caja; la de un pedido la ve su dueña o caja. Cambiar o borrar es solo de caja
 * (caja:escritura). La clienta solo SOLICITA un CFDI de un pedido suyo: nace 'solicitada' y sin datos fiscales.
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  cajera: ['caja:lectura', 'caja:escritura'],
  estilista: ['citas:escritura', 'clientes:lectura', 'pedidos:entregar'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'cli-2': 'cliente', 'caj-1': 'cajera', 'est-1': 'estilista', 'adm-1': 'admin' };

function montarPrisma() {
  const pedidos = [{ id: 9, usuarioId: 'cli-1' }, { id: 10, usuarioId: 'cli-2' }];
  const facturas: any[] = [
    { id: 1, tipo: 'nota', pedidoId: null, monto: 300, clienteNombre: 'Mostrador', estado: null, folio: null, uuidFiscal: null },
    { id: 2, tipo: 'cfdi', pedidoId: 9, estado: 'solicitada', folio: null, uuidFiscal: null },
    { id: 3, tipo: 'cfdi', pedidoId: 10, estado: 'emitida', folio: 'A-1', uuidFiscal: 'U-1' },
  ];
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    pedido: { findUnique: jest.fn(async ({ where }: any) => pedidos.find((p) => p.id === where.id) ?? null) },
    factura: {
      findUnique: jest.fn(async ({ where }: any) => facturas.find((f) => f.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => facturas.filter((f) => !where || f.pedidoId === where.pedidoId)),
      create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...facturas.find((f) => f.id === where.id), ...data })),
      delete: jest.fn(async () => ({})),
    },
  };
  return prisma;
}

describe('FacturasService: quién lee, solicita, cambia y borra', () => {
  const montar = () => {
    const prisma = montarPrisma();
    return { prisma, service: new FacturasService(prisma, new EcommerceAccessService(prisma)) };
  };

  // Sin permiso responde lo mismo que si no existiera (404 y mismo mensaje): no se revela qué ids existen.
  const NO_ENCONTRADA = { status: 404, message: 'Factura no encontrada' };

  it('GET /facturas/:id de una nota sin pedido: la clienta recibe 404; caja y admin sí la ven', async () => {
    const { service } = montar();
    await expect(service.obtenerPorId(1, 'cli-1')).rejects.toMatchObject(NO_ENCONTRADA);
    await expect(service.obtenerPorId(1, 'est-1')).rejects.toMatchObject(NO_ENCONTRADA);
    await expect(service.obtenerPorId(1, 'caj-1')).resolves.toMatchObject({ data: { id: 1 } });
    await expect(service.obtenerPorId(1, 'adm-1')).resolves.toMatchObject({ data: { id: 1 } });
  });

  it('GET /facturas/:id con pedido: la dueña y caja la ven; otra clienta recibe 404', async () => {
    const { service } = montar();
    await expect(service.obtenerPorId(2, 'cli-1')).resolves.toMatchObject({ data: { id: 2 } });
    await expect(service.obtenerPorId(2, 'caj-1')).resolves.toMatchObject({ data: { id: 2 } });
    await expect(service.obtenerPorId(2, 'cli-2')).rejects.toMatchObject(NO_ENCONTRADA);
  });

  it('GET /facturas/:id: ajena e inexistente son indistinguibles', async () => {
    const { service } = montar();
    await expect(service.obtenerPorId(777, 'cli-2')).rejects.toMatchObject(NO_ENCONTRADA);
    await expect(service.obtenerPorId(3, 'cli-1')).rejects.toMatchObject(NO_ENCONTRADA);
  });

  it('actualizar y eliminar sin caja:escritura: 403 sin escribir, aunque sea la factura de su propio pedido o una sin pedido', async () => {
    const { service, prisma } = montar();
    for (const id of [1, 2]) {
      await expect(service.actualizar(id, 'cli-1', { folio: 'X', estado: 'emitida' } as any)).rejects.toMatchObject({ status: 403 });
      await expect(service.eliminar(id, 'cli-1')).rejects.toMatchObject({ status: 403 });
    }
    expect(prisma.factura.update).not.toHaveBeenCalled();
    expect(prisma.factura.delete).not.toHaveBeenCalled();
  });

  it('caja actualiza y elimina cualquier factura (con o sin pedido)', async () => {
    const { service, prisma } = montar();
    await service.actualizar(3, 'caj-1', { pdfUrl: 'https://x/f.pdf' } as any);
    await service.eliminar(1, 'caj-1');
    expect(prisma.factura.update).toHaveBeenCalled();
    expect(prisma.factura.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('POST de la clienta sobre su pedido: nace solicitada e ignora folio, UUID, URLs y monto', async () => {
    const { service, prisma } = montar();
    await service.crear('cli-1', {
      tipo: 'cfdi',
      pedidoId: 9,
      folio: 'F-1',
      uuidFiscal: 'UUID-FALSO',
      pdfUrl: 'https://malo/x.pdf',
      xmlUrl: 'https://malo/x.xml',
      estado: 'emitida',
      rfc: 'XAXX010101000',
      razonSocial: 'Mi razón social',
    } as any);
    expect(prisma.factura.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipo: 'cfdi',
        pedidoId: 9,
        creadoPorId: 'cli-1',
        estado: 'solicitada',
        folio: null,
        uuidFiscal: null,
        pdfUrl: null,
        xmlUrl: null,
        monto: null,
        rfc: 'XAXX010101000',
        razonSocial: 'Mi razón social',
      }),
    });
  });

  it('POST de la clienta sin pedido, con pedido ajeno o de tipo nota: rechazado sin crear', async () => {
    const { service, prisma } = montar();
    await expect(service.crear('cli-1', { tipo: 'cfdi', estado: 'solicitada' } as any)).rejects.toMatchObject({ status: 403 });
    await expect(service.crear('cli-1', { tipo: 'cfdi', pedidoId: 10, estado: 'solicitada' } as any)).rejects.toMatchObject({ status: 403 });
    await expect(
      service.crear('cli-1', { tipo: 'nota', pedidoId: 9, clienteNombre: 'Yo', concepto: 'x', monto: 1 } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.factura.create).not.toHaveBeenCalled();
  });

  it('POST de caja conserva los datos fiscales que captura', async () => {
    const { service, prisma } = montar();
    await service.crear('caj-1', { tipo: 'cfdi', pedidoId: 10, folio: 'B-7', uuidFiscal: 'U-7', estado: 'emitida' } as any);
    expect(prisma.factura.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ pedidoId: 10, folio: 'B-7', uuidFiscal: 'U-7', estado: 'emitida' }),
    });
  });

  it('GET /facturas/pedido/:id?propios=true: un pedido ajeno responde 404 incluso al admin', async () => {
    const { service } = montar();
    await expect(service.listarPorPedido(10, 'adm-1', true)).rejects.toMatchObject({ status: 404 });
    await expect(service.listarPorPedido(9, 'cli-1', true)).resolves.toMatchObject({ success: true });
    await expect(service.listarPorPedido(10, 'adm-1')).resolves.toMatchObject({ success: true });
  });
});

describe('PUT y DELETE /api/facturas/:id piden caja:escritura (PermisosGuard real)', () => {
  let app: INestApplication;
  let base: string;
  const service = {
    actualizar: jest.fn(async () => ({ success: true })),
    eliminar: jest.fn(async () => ({ success: true })),
    listarPorPedido: jest.fn(async () => ({ success: true })),
  };

  beforeAll(async () => {
    const jwt = { canActivate: (ctx: any) => { const req = ctx.switchToHttp().getRequest(); req.user = { id: req.headers['x-usuario'] }; return true; } };
    const modulo = await Test.createTestingModule({
      controllers: [FacturasController],
      providers: [
        { provide: FacturasService, useValue: service },
        { provide: PrismaService, useValue: montarPrisma() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwt)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = (metodo: string, ruta: string, usuario: string, cuerpo?: unknown) =>
    fetch(`${base}/api/facturas/${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-usuario': usuario },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  it('la clienta recibe 403 en PUT y DELETE y el servicio no se llama', async () => {
    expect((await pedir('PUT', '2', 'cli-1', { folio: 'X' })).status).toBe(403);
    expect((await pedir('DELETE', '2', 'cli-1')).status).toBe(403);
    expect(service.actualizar).not.toHaveBeenCalled();
    expect(service.eliminar).not.toHaveBeenCalled();
  });

  it('caja pasa el guard', async () => {
    expect((await pedir('PUT', '2', 'caj-1', { folio: 'X' })).status).toBe(200);
    expect((await pedir('DELETE', '2', 'caj-1')).status).toBe(200);
  });

  it('GET /facturas/pedido/:id pasa ?propios=true al servicio', async () => {
    await pedir('GET', 'pedido/10?propios=true', 'cli-1');
    expect(service.listarPorPedido).toHaveBeenCalledWith(10, 'cli-1', true);
  });
});
