import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PagosEnLineaController } from './pagos-en-linea.controller';
import { PagosEnLineaService } from './pagos-en-linea.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const SECRETO = 'secreto-webhook-prueba';

describe('Pagos en línea por HTTP', () => {
  let app: INestApplication;
  let base: string;
  const servicio = {
    procesarPago: jest.fn(async () => 'pagado'),
    crearPreferencia: jest.fn(async () => ({ initPoint: 'https://mp.test/pagar' })),
    consultarEstado: jest.fn(async () => ({ estado: 'pendiente', pedidoEstado: 'pendiente_pago' })),
  };

  beforeAll(async () => {
    process.env.MP_WEBHOOK_SECRET = SECRETO;
    const modulo = await Test.createTestingModule({
      controllers: [PagosEnLineaController],
      providers: [{ provide: PagosEnLineaService, useValue: servicio }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx: any) => ((ctx.switchToHttp().getRequest().user = { id: 'clienta-1' }), true) })
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

  const notificar = (opciones: { dataId?: string; tipo?: string; firma?: string; requestId?: string }) =>
    fetch(`${base}/api/pagos-en-linea/mercadopago/webhook?data.id=${opciones.dataId ?? '777'}&type=${opciones.tipo ?? 'payment'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': opciones.requestId ?? 'req-1',
        ...(opciones.firma !== undefined ? { 'x-signature': opciones.firma } : {}),
      },
      body: JSON.stringify({ type: opciones.tipo ?? 'payment', data: { id: opciones.dataId ?? '777' } }),
    });
  const firma = (dataId = '777', requestId = 'req-1', ts = '1759510800') =>
    `ts=${ts},v1=${createHmac('sha256', SECRETO).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;

  it('webhook con firma inválida: 401 y no consulta ni procesa nada', async () => {
    expect((await notificar({ firma: 'ts=1,v1=abcdef' })).status).toBe(401);
    expect((await notificar({})).status).toBe(401);
    expect(servicio.procesarPago).not.toHaveBeenCalled();
  });

  it('webhook firmado de un pago: 200 y procesa el data.id de la URL', async () => {
    const res = await notificar({ firma: firma() });
    expect(res.status).toBe(200);
    expect(servicio.procesarPago).toHaveBeenCalledWith('777');
  });

  it('webhook firmado de otro tipo (merchant_order): 200 sin procesar', async () => {
    const res = await notificar({ tipo: 'merchant_order', firma: firma() });
    expect(res.status).toBe(200);
    expect(servicio.procesarPago).not.toHaveBeenCalled();
  });

  it('crear la preferencia solo acepta el id del pedido: un total enviado por el navegador da 400', async () => {
    const enviar = (cuerpo: unknown) =>
      fetch(`${base}/api/pagos-en-linea/mercadopago/preferencia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

    expect((await enviar({ pedidoId: 42, total: 1 })).status).toBe(400);
    expect(servicio.crearPreferencia).not.toHaveBeenCalled();

    const ok = await enviar({ pedidoId: 42 });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ initPoint: 'https://mp.test/pagar' });
    expect(servicio.crearPreferencia).toHaveBeenCalledWith(42, 'clienta-1');
  });

  it('estado del pago de un pedido para la confirmación', async () => {
    const res = await fetch(`${base}/api/pagos-en-linea/mercadopago/estado/42`);
    expect(await res.json()).toEqual({ estado: 'pendiente', pedidoEstado: 'pendiente_pago' });
    expect(servicio.consultarEstado).toHaveBeenCalledWith(42, 'clienta-1');
  });
});
