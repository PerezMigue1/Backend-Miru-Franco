import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';

describe('/api/pagos: un id que no es número responde 400, no 500', () => {
  let app: INestApplication;
  let base: string;
  const pagos = {
    obtenerPorId: jest.fn(async () => ({ success: true })),
    listarPorPedido: jest.fn(async () => ({ success: true })),
    actualizar: jest.fn(async () => ({ success: true })),
  };
  const conUsuario = {
    canActivate: (ctx: any) => {
      ctx.switchToHttp().getRequest().user = { id: 'cajera-1' };
      return true;
    },
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [PagosController],
      providers: [
        { provide: PagosService, useValue: pagos },
        { provide: EcommerceAccessService, useValue: { assertPedidoLectura: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(conUsuario)
      .overrideGuard(PermisosGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['GET', '/api/pagos/abc'],
    ['GET', '/api/pagos/pedido/abc'],
    ['PATCH', '/api/pagos/abc'],
  ])('%s %s: 400 "Id inválido" y el servicio no se llama', async (metodo, ruta) => {
    const res = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: metodo === 'PATCH' ? JSON.stringify({}) : undefined,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Id inválido');
    expect(pagos.obtenerPorId).not.toHaveBeenCalled();
    expect(pagos.listarPorPedido).not.toHaveBeenCalled();
    expect(pagos.actualizar).not.toHaveBeenCalled();
  });

  it('con un id numérico llega como número al servicio', async () => {
    expect((await fetch(`${base}/api/pagos/5`)).status).toBe(200);
    expect(pagos.obtenerPorId).toHaveBeenCalledWith(5, 'cajera-1');
  });
});
