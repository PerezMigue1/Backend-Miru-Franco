import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentosLegalesAdminController, DocumentosLegalesPublicoController } from './documentos-legales.controller';
import { DocumentosLegalesService } from './documentos-legales.service';

describe('Rutas /api/documentos-legales', () => {
  let app: INestApplication;
  let base: string;
  const servicio = {
    vigentes: jest.fn(),
    vigente: jest.fn(),
    listar: jest.fn(),
    afectadosPorReglas: jest.fn(),
    historial: jest.fn(),
    verVersion: jest.fn(),
    borrador: jest.fn(),
    guardarBorrador: jest.fn(),
    descartarBorrador: jest.fn(),
    vistaPrevia: jest.fn(),
    prepararVersion: jest.fn(),
    publicar: jest.fn(),
  };
  const sesion: CanActivate = {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const id = req.headers['x-usuaria'];
      if (!id) return false;
      req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
      return true;
    },
  };
  const soloAdmin: CanActivate = { canActivate: (ctx) => ctx.switchToHttp().getRequest().user?.rol === 'admin' };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [DocumentosLegalesPublicoController, DocumentosLegalesAdminController],
      providers: [
        { provide: DocumentosLegalesService, useValue: servicio },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesion)
      .overrideGuard(PermisosGuard)
      .useValue(soloAdmin)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    for (const fn of Object.values(servicio)) fn.mockReset().mockResolvedValue({});
  });

  afterAll(async () => {
    await app.close();
  });

  const admin = { 'x-usuaria': 'admin-1', 'x-rol': 'admin', 'Content-Type': 'application/json' };

  it('el texto vigente es público y con caché corta', async () => {
    servicio.vigente.mockResolvedValue({ slug: 'terminos', html: '<main></main>' });
    const r = await fetch(`${base}/api/documentos-legales/terminos/vigente`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('max-age=60');
    expect((await r.json()).data).toMatchObject({ slug: 'terminos' });
    expect((await fetch(`${base}/api/documentos-legales/vigentes`)).status).toBe(200);
  });

  it('el panel pide sesión de admin (configuracion:editar)', async () => {
    expect((await fetch(`${base}/api/documentos-legales/admin`)).status).toBe(403);
    expect((await fetch(`${base}/api/documentos-legales/admin`, { headers: { 'x-usuaria': 'c-1' } })).status).toBe(403);
    expect((await fetch(`${base}/api/documentos-legales/admin`, { headers: admin })).status).toBe(200);
  });

  it('publicar pasa la versión, la fecha, el motivo y la casilla a quien publica', async () => {
    const cuerpo = { plantilla: '## A\n\nB', version: '2.1', vigenteDesde: '2026-10-20', motivo: 'Cambio de prueba.', requiereAceptacion: false };
    const r = await fetch(`${base}/api/documentos-legales/admin/terminos/publicar`, { method: 'POST', headers: admin, body: JSON.stringify(cuerpo) });
    expect(r.status).toBe(201);
    expect(servicio.publicar).toHaveBeenCalledWith('terminos', expect.objectContaining(cuerpo), 'admin-1');
  });

  it('publicar rechaza campos de más y una casilla que no es booleana', async () => {
    const base0 = { plantilla: '## A\n\nB', version: '2.1', vigenteDesde: '2026-10-20', motivo: 'Cambio de prueba.' };
    for (const cuerpo of [{ ...base0, hashTexto: 'x' }, { ...base0, requiereAceptacion: 'no' }, { ...base0, plantilla: 5 }]) {
      const r = await fetch(`${base}/api/documentos-legales/admin/terminos/publicar`, { method: 'POST', headers: admin, body: JSON.stringify(cuerpo) });
      expect(r.status).toBe(400);
    }
    expect(servicio.publicar).not.toHaveBeenCalled();
  });

  it('afectados por reglas: GET con las de hoy y POST con las propuestas', async () => {
    await fetch(`${base}/api/documentos-legales/admin/afectados-por-reglas`, { headers: admin });
    expect(servicio.afectadosPorReglas).toHaveBeenLastCalledWith();
    const reglas = { garantia: { diasServicio: 10 } };
    const r = await fetch(`${base}/api/documentos-legales/admin/afectados-por-reglas`, { method: 'POST', headers: admin, body: JSON.stringify({ reglas }) });
    expect(r.status).toBe(200);
    expect(servicio.afectadosPorReglas).toHaveBeenLastCalledWith(reglas);
  });

  it('preparar versión y borrador', async () => {
    expect((await fetch(`${base}/api/documentos-legales/admin/terminos/preparar-version`, { method: 'POST', headers: admin })).status).toBe(200);
    expect(servicio.prepararVersion).toHaveBeenCalledWith('terminos', 'admin-1');
    const r = await fetch(`${base}/api/documentos-legales/admin/terminos/borrador`, { method: 'PUT', headers: admin, body: JSON.stringify({ plantilla: 'Hola' }) });
    expect(r.status).toBe(200);
    expect(servicio.guardarBorrador).toHaveBeenCalledWith('terminos', 'Hola', 'admin-1');
  });

  it('no hay rutas para modificar o borrar una versión publicada', async () => {
    for (const metodo of ['PUT', 'PATCH', 'DELETE']) {
      const r = await fetch(`${base}/api/documentos-legales/admin/terminos/versiones/2.0`, { method: metodo, headers: admin });
      expect(r.status).toBe(404);
    }
  });
});
