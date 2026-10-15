import { CanActivate, ExecutionContext, ForbiddenException, INestApplication, NotFoundException, RequestMethod, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { ClientesController } from './clientes.controller';
import { ClientesModule } from './clientes.module';
import { ClientesService } from './clientes.service';
import { CrearObservacionDto } from './dto/crear-observacion.dto';
import { ObservacionesClienteService } from './observaciones-cliente.service';
import { SegmentacionClientesService } from './segmentacion-clientes.service';

/**
 * Observaciones del CRM sobre una clienta: GET (clientes:lectura) y POST (clientes:escritura).
 * Solo sobre usuarias con rol cliente: el personal no anota sobre otro personal; el admin sí.
 */
const ROL_DE: Record<string, string> = { 'cli-1': 'cliente', 'est-1': 'estilista', 'est-2': 'estilista', 'adm-1': 'admin' };
const NOMBRE_DE: Record<string, string> = { 'est-1': 'Estilista Uno', 'adm-1': 'Admin Salón' };
const FECHA = new Date('2026-10-14T16:00:00.000Z');

function prismaFalso() {
  const guardadas: any[] = [
    { id: 1, clienteId: 'cli-1', autorId: 'adm-1', texto: 'Prefiere citas por la tarde', creadoEn: new Date('2026-10-01T16:00:00.000Z') },
  ];
  const conAutor = (o: any) => ({ id: o.id, texto: o.texto, creadoEn: o.creadoEn, autor: { id: o.autorId, nombre: NOMBRE_DE[o.autorId] } });
  return {
    guardadas,
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    observacionCliente: {
      findMany: jest.fn(async ({ where }: any) => guardadas.filter((o) => o.clienteId === where.clienteId).map(conAutor)),
      create: jest.fn(async ({ data }: any) => {
        const nueva = { id: guardadas.length + 1, ...data, creadoEn: FECHA };
        guardadas.push(nueva);
        return conAutor(nueva);
      }),
    },
  };
}

describe('ObservacionesClienteService', () => {
  it('lista las observaciones de una clienta con autor (nombre) y fecha', async () => {
    const prisma = prismaFalso();
    const s = new ObservacionesClienteService(prisma as any);
    const res = await s.listar('cli-1', { id: 'est-1', rol: 'estilista' });
    expect(res).toMatchObject({ success: true, count: 1 });
    expect(res.data[0]).toEqual({
      id: 1,
      texto: 'Prefiere citas por la tarde',
      creadoEn: new Date('2026-10-01T16:00:00.000Z'),
      autor: { id: 'adm-1', nombre: 'Admin Salón' },
    });
    expect(prisma.observacionCliente.findMany.mock.calls[0][0].orderBy).toEqual([{ creadoEn: 'desc' }, { id: 'desc' }]);
  });

  it('agrega una observación con la autora que la escribe y responde autor y fecha', async () => {
    const prisma = prismaFalso();
    const s = new ObservacionesClienteService(prisma as any);
    const res = await s.crear('cli-1', 'Alergia leve al amoniaco', { id: 'est-1', rol: 'estilista' });
    expect(prisma.observacionCliente.create.mock.calls[0][0].data).toEqual({ clienteId: 'cli-1', autorId: 'est-1', texto: 'Alergia leve al amoniaco' });
    expect(res).toEqual({
      success: true,
      data: { id: 2, texto: 'Alergia leve al amoniaco', creadoEn: FECHA, autor: { id: 'est-1', nombre: 'Estilista Uno' } },
    });
  });

  it('el personal no lee ni anota sobre otro miembro del personal (403); el admin sí', async () => {
    const prisma = prismaFalso();
    const s = new ObservacionesClienteService(prisma as any);
    await expect(s.listar('est-2', { id: 'est-1', rol: 'estilista' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.crear('est-2', 'Nota', { id: 'est-1', rol: 'estilista' })).rejects.toThrow('Solo puedes ver o agregar observaciones de clientas.');
    expect(prisma.observacionCliente.create).not.toHaveBeenCalled();
    await expect(s.crear('est-2', 'Nota del admin', { id: 'adm-1', rol: 'admin' })).resolves.toMatchObject({ success: true });
    await expect(s.listar('est-2', { id: 'adm-1', rol: 'admin' })).resolves.toMatchObject({ success: true });
  });

  it('usuaria inexistente: 404 en español', async () => {
    const s = new ObservacionesClienteService(prismaFalso() as any);
    await expect(s.listar('no-existe', { id: 'adm-1', rol: 'admin' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.crear('no-existe', 'x', { id: 'adm-1', rol: 'admin' })).rejects.toThrow('Cliente no encontrado');
  });
});

describe('CrearObservacionDto', () => {
  const errores = async (texto: unknown) => {
    const e = await validate(plainToInstance(CrearObservacionDto, { texto }));
    return e.flatMap((x) => Object.values(x.constraints ?? {}));
  };

  it('texto obligatorio (vacío o solo espacios) con mensaje en español', async () => {
    expect(await errores('')).toContain('Escribe la observación.');
    expect(await errores('    ')).toContain('Escribe la observación.');
    expect(await errores(undefined)).toContain('Escribe la observación.');
  });

  it('máximo 1000 caracteres', async () => {
    expect(await errores('a'.repeat(1000))).toEqual([]);
    expect(await errores('a'.repeat(1001))).toContain('La observación puede tener como máximo 1000 caracteres.');
  });

  it('quita los espacios de los extremos', () => {
    expect(plainToInstance(CrearObservacionDto, { texto: '  Hola  ' }).texto).toBe('Hola');
  });
});

describe('Rutas /clientes/:id/observaciones', () => {
  it('GET con clientes:lectura y POST con clientes:escritura', () => {
    const listar = ClientesController.prototype.listarObservaciones;
    const crear = ClientesController.prototype.crearObservacion;
    expect(Reflect.getMetadata(PATH_METADATA, listar)).toBe(':id/observaciones');
    expect(Reflect.getMetadata(METHOD_METADATA, listar)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('permisos', listar) ?? Reflect.getMetadata('permisos', ClientesController)).toEqual(['clientes:lectura']);
    expect(Reflect.getMetadata(PATH_METADATA, crear)).toBe(':id/observaciones');
    expect(Reflect.getMetadata(METHOD_METADATA, crear)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('permisos', crear)).toEqual(['clientes:escritura']);
  });

  it('el servicio está registrado en ClientesModule', () => {
    expect(Reflect.getMetadata('providers', ClientesModule)).toContain(ObservacionesClienteService);
  });

  describe('HTTP', () => {
    let app: INestApplication;
    let base: string;
    const observaciones = { listar: jest.fn(), crear: jest.fn() };

    /** La usuaria llega en headers de prueba (el JwtAuthGuard real pide un JWT firmado). */
    const sesionFalsa: CanActivate = {
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers['x-usuaria']) throw new UnauthorizedException();
        req.user = { id: req.headers['x-usuaria'], rol: req.headers['x-rol'] };
        return true;
      },
    };

    beforeAll(async () => {
      const modulo = await Test.createTestingModule({
        controllers: [ClientesController],
        providers: [
          { provide: ClientesService, useValue: {} },
          { provide: SegmentacionClientesService, useValue: {} },
          { provide: ObservacionesClienteService, useValue: observaciones },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue(sesionFalsa)
        .overrideGuard(PermisosGuard)
        .useValue({ canActivate: () => true })
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

    beforeEach(() => {
      observaciones.listar.mockReset().mockResolvedValue({ success: true, count: 0, data: [] });
      observaciones.crear.mockReset().mockResolvedValue({ success: true, data: { id: 9 } });
    });

    const post = (cuerpo: unknown) =>
      fetch(`${base}/api/clientes/cli-1/observaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-usuaria': 'est-1', 'x-rol': 'estilista' },
        body: JSON.stringify(cuerpo),
      });

    it('POST válido: 201 y pasa la clienta, el texto limpio y quién escribe', async () => {
      const res = await post({ texto: '  Prefiere tonos fríos  ' });
      expect(res.status).toBe(201);
      expect(observaciones.crear).toHaveBeenCalledWith('cli-1', 'Prefiere tonos fríos', { id: 'est-1', rol: 'estilista' });
    });

    it('POST sin texto o con más de 1000 caracteres: 400 con el mensaje en español', async () => {
      const vacio = await post({ texto: '' });
      expect(vacio.status).toBe(400);
      expect(JSON.stringify(await vacio.json())).toContain('Escribe la observación.');
      const largo = await post({ texto: 'a'.repeat(1001) });
      expect(largo.status).toBe(400);
      expect(JSON.stringify(await largo.json())).toContain('La observación puede tener como máximo 1000 caracteres.');
      expect(observaciones.crear).not.toHaveBeenCalled();
    });

    it('GET: pasa la clienta y quién consulta', async () => {
      const res = await fetch(`${base}/api/clientes/cli-1/observaciones`, { headers: { 'x-usuaria': 'adm-1', 'x-rol': 'admin' } });
      expect(res.status).toBe(200);
      expect(observaciones.listar).toHaveBeenCalledWith('cli-1', { id: 'adm-1', rol: 'admin' });
    });
  });
});
