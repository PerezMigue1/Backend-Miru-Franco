import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { BinLookupController } from './bin-lookup.controller';
import { MetodosPagoController } from './metodos-pago.controller';
import { MetodosPagoService } from './metodos-pago.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/** Con Mercado Pago Checkout Pro el sitio ya no recibe ni guarda datos de tarjeta. */
describe('Sin datos de tarjeta en el sitio', () => {
  let app: INestApplication;
  let base: string;
  const metodos = { crear: jest.fn(), listar: jest.fn(async () => ({ success: true, data: [] })), eliminar: jest.fn(async () => ({ success: true })) };
  const fetchOriginal = global.fetch;
  const fetchEspia = jest.fn();

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [BinLookupController, MetodosPagoController],
      providers: [{ provide: MetodosPagoService, useValue: metodos }],
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
    global.fetch = fetchOriginal;
    await app.close();
  });

  it('guardar una tarjeta responde 410 y no guarda nada', async () => {
    const res = await fetch(`${base}/api/payments/metodos-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proveedor: 'checkout_manual', idExterno: 'x', ultimos4: '4242' }),
    });
    expect(res.status).toBe(410);
    expect(metodos.crear).not.toHaveBeenCalled();
  });

  it('editar una tarjeta guardada también responde 410', async () => {
    const res = await fetch(`${base}/api/payments/metodos-pago/abc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ etiqueta: 'mi tarjeta' }),
    });
    expect(res.status).toBe(410);
  });

  it('la búsqueda de BIN responde 410, no repite los dígitos y no llama a ningún servicio externo', async () => {
    const res = await fetch(`${base}/api/payments/bin-lookup?bin=4242424242424242`);
    const texto = await res.text();
    global.fetch = fetchEspia as unknown as typeof fetch;
    expect(res.status).toBe(410);
    expect(texto).not.toMatch(/424242/);
    expect(fetchEspia).not.toHaveBeenCalled();
    global.fetch = fetchOriginal;
  });

  it('las tarjetas que ya existían se pueden seguir listando y borrando', async () => {
    expect((await fetch(`${base}/api/payments/metodos-pago`)).status).toBe(200);
    expect((await fetch(`${base}/api/payments/metodos-pago/abc`, { method: 'DELETE' })).status).toBe(200);
  });
});
