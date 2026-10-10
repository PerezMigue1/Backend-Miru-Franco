import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { EmpleadosController } from './empleados.controller';
import { EmpleadosService } from './empleados.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { RolesGuard } from '../common/guards/roles.guard';

/**
 * Editar empleado: la web (gestion-personal) manda PATCH /api/empleados/:usuarioId y antes solo existía PUT,
 * así que respondía 404. PATCH y PUT deben llegar al mismo método con el mismo DTO y la misma validación
 * global de main.ts. Los guards y el servicio son falsos.
 */
describe('PATCH y PUT /api/empleados/:usuarioId', () => {
  let app: INestApplication;
  let base: string;
  const empleadosService = { actualizar: jest.fn(async (usuarioId: string, _dto: unknown) => ({ success: true, data: { usuarioId } })) };

  beforeAll(async () => {
    const pasa = { canActivate: (ctx: any) => ((ctx.switchToHttp().getRequest().user = { id: 'admin-1', rol: 'admin' }), true) };
    const modulo = await Test.createTestingModule({
      controllers: [EmpleadosController],
      providers: [{ provide: EmpleadosService, useValue: empleadosService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(pasa)
      .overrideGuard(PermisosGuard)
      .useValue(pasa)
      .overrideGuard(RolesGuard)
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

  beforeEach(() => empleadosService.actualizar.mockClear());

  const enviar = (metodo: 'PATCH' | 'PUT', cuerpo: unknown) =>
    fetch(`${base}/api/empleados/usuario-9`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  // Lo que manda handleEditar en la web (los campos vacíos van como undefined y JSON.stringify los quita).
  const cuerpoWeb = { puesto: 'Colorista', especialidades: ['Balayage'], telefono: '5512345678', comisionPorcentaje: 15, activo: true };

  it.each(['PATCH', 'PUT'] as const)('%s con el cuerpo de la web responde 200 y llama a actualizar con el mismo DTO', async (metodo) => {
    const res = await enviar(metodo, cuerpoWeb);

    expect(res.status).toBe(200);
    expect(empleadosService.actualizar).toHaveBeenCalledTimes(1);
    expect(empleadosService.actualizar).toHaveBeenCalledWith('usuario-9', expect.objectContaining(cuerpoWeb));
    expect((empleadosService.actualizar.mock.calls[0][1] as object).constructor.name).toBe('UpdateEmpleadoDto');
  });

  it.each(['PATCH', 'PUT'] as const)('%s rechaza con 400 usuarioId, campos desconocidos y comisión fuera de rango', async (metodo) => {
    for (const malo of [{ usuarioId: 'otro' }, { rol: 'admin' }, { comisionPorcentaje: 150 }, { puesto: '' }]) {
      const res = await enviar(metodo, { puesto: 'Colorista', ...malo });
      expect(res.status).toBe(400);
    }
    expect(empleadosService.actualizar).not.toHaveBeenCalled();
  });
});

describe('EmpleadosService.actualizar', () => {
  const montar = (perfil: unknown) => {
    const prisma = {
      perfilEmpleado: {
        findUnique: jest.fn(async () => perfil),
        update: jest.fn(async ({ data }: any) => ({ usuarioId: 'usuario-9', ...data })),
      },
    };
    return { servicio: new EmpleadosService(prisma as any), prisma };
  };

  it('un cuerpo parcial solo escribe las claves presentes', async () => {
    const { servicio, prisma } = montar({ usuarioId: 'usuario-9' });

    await servicio.actualizar('usuario-9', { comisionPorcentaje: 20 } as any);

    expect(prisma.perfilEmpleado.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuarioId: 'usuario-9' }, data: { comisionPorcentaje: 20 } }),
    );
  });

  it('perfil inexistente: 404 sin escribir', async () => {
    const { servicio, prisma } = montar(null);

    await expect(servicio.actualizar('nadie', { puesto: 'X' } as any)).rejects.toMatchObject({ status: 404 });
    expect(prisma.perfilEmpleado.update).not.toHaveBeenCalled();
  });
});
