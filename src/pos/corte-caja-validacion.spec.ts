import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';

/**
 * POST /api/pos/cortes con la misma validación global que main.ts: lo que manda ahora el frontend
 * (fecha de hoy en México + efectivo inicial y final) pasa; lo que mandaba antes respondía 400.
 * El servicio es falso: no se crea ningún corte.
 */
describe('POST /api/pos/cortes: validación del cuerpo', () => {
  let app: INestApplication;
  let base: string;
  const posService = { crearCorte: jest.fn(async () => ({ id: 1 })) };

  beforeAll(async () => {
    const pasa = { canActivate: (ctx: any) => ((ctx.switchToHttp().getRequest().user = { id: 'cajera-1' }), true) };
    const modulo = await Test.createTestingModule({
      controllers: [PosController],
      providers: [{ provide: PosService, useValue: posService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(pasa)
      .overrideGuard(PermisosGuard)
      .useValue(pasa)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const enviar = (cuerpo: unknown) =>
    fetch(`${base}/api/pos/cortes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  it('el cuerpo nuevo del frontend (fecha + efectivo inicial y final) no da 400 y llega al servicio', async () => {
    const res = await enviar({ fecha: '2026-10-03', efectivoInicial: 500, efectivoFinal: 1250.5, notas: 'Turno tarde' });

    expect(res.status).toBe(201);
    expect(posService.crearCorte).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: '2026-10-03', efectivoInicial: 500, efectivoFinal: 1250.5 }),
      'cajera-1',
    );
  });

  it('el cuerpo anterior (sin fecha ni efectivo final) respondía 400 sin llegar al servicio', async () => {
    posService.crearCorte.mockClear();
    const res = await enviar({ efectivoInicial: 500 });

    expect(res.status).toBe(400);
    expect(posService.crearCorte).not.toHaveBeenCalled();
  });
});
