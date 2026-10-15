import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { DbController } from './db.controller';
import { TruncateTableDto } from './dto/truncate-table.dto';
import { ImportTableDto } from './dto/import-table.dto';
import { crearErrorDeValidacion } from '../common/filters/errores-validacion';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

/** Mismo ValidationPipe global que main.ts: así responde el backend real a un body inválido. */
const pipeGlobal = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: crearErrorDeValidacion,
});

async function errorDeValidacion(metatype: new () => unknown, body: Record<string, unknown>) {
  try {
    await pipeGlobal.transform(body, { type: 'body', metatype });
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('se esperaba un 400 de validación');
}

describe('DTO de truncate e importar: la confirmación es obligatoria desde la validación (punto 14)', () => {
  it('POST /db/truncate sin confirmacion: 400 con mensaje en español que dice qué escribir', async () => {
    const e = await errorDeValidacion(TruncateTableDto, { tabla: 'servicios' });
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getStatus()).toBe(400);
    const r = e.getResponse() as { message?: string; errors?: Record<string, string> };
    expect(r.errors?.confirmacion).toBe(
      'Confirmación requerida: escribe exactamente "TRUNCATE <tabla>" en el campo confirmacion',
    );
  });

  it('POST /db/truncate con confirmacion vacía también es 400', async () => {
    const e = await errorDeValidacion(TruncateTableDto, { tabla: 'servicios', confirmacion: '   ' });
    expect(e.getStatus()).toBe(400);
  });

  it('POST /db/import sin confirmacion: 400 con mensaje en español que dice qué escribir', async () => {
    const e = await errorDeValidacion(ImportTableDto, { tabla: 'servicios', modo: 'append' });
    expect(e.getStatus()).toBe(400);
    const r = e.getResponse() as { errors?: Record<string, string> };
    expect(r.errors?.confirmacion).toBe(
      'Confirmación requerida: escribe exactamente "IMPORTAR <tabla>" en el campo confirmacion',
    );
  });

  it('con confirmacion el DTO pasa (el texto exacto lo revisan servicio y controlador)', async () => {
    await expect(
      pipeGlobal.transform(
        { tabla: 'servicios', confirmacion: 'TRUNCATE servicios' },
        { type: 'body', metatype: TruncateTableDto },
      ),
    ).resolves.toMatchObject({ tabla: 'servicios', confirmacion: 'TRUNCATE servicios' });
    await expect(
      pipeGlobal.transform(
        { tabla: 'servicios', modo: 'append', confirmacion: 'IMPORTAR servicios' },
        { type: 'body', metatype: ImportTableDto },
      ),
    ).resolves.toMatchObject({ confirmacion: 'IMPORTAR servicios' });
  });
});

describe('GET /db/backup: respaldo completo solo para admin (punto 13)', () => {
  it('el controlador /db exige sesión y rol admin, y el respaldo completo vive en GET backup', () => {
    expect(Reflect.getMetadata('roles', DbController)).toEqual(['admin']);
    expect(Reflect.getMetadata('__guards__', DbController)).toEqual([JwtAuthGuard, RolesGuard]);
    const handler = DbController.prototype.respaldoCompleto;
    expect(Reflect.getMetadata('path', handler)).toBe('backup');
    // Ningún @Roles propio que afloje el de la clase.
    expect(Reflect.getMetadata('roles', handler)).toBeUndefined();
  });
});

const archivo = { buffer: Buffer.from('[]'), originalname: 'datos.json', size: 2 };

function makeController() {
  const dbService: any = {
    importar: jest.fn(async () => ({ success: true, importados: 1 })),
  };
  const exportDirectService: any = {};
  return { controller: new DbController(dbService, exportDirectService), dbService };
}

describe('POST /db/import: confirmación explícita y tablas bloqueadas (punto 14)', () => {
  it('sin confirmación responde 400 en español y no llega al servicio', async () => {
    const { controller, dbService } = makeController();
    const e = await controller
      .importar(archivo as any, { tabla: 'servicios', formato: 'json' } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    const respuesta = (e as BadRequestException).getResponse() as { message?: string };
    expect(respuesta.message).toContain('IMPORTAR servicios');
    expect(dbService.importar).not.toHaveBeenCalled();
  });

  it('con una confirmación distinta responde 400 y no importa', async () => {
    const { controller, dbService } = makeController();
    const e = await controller
      .importar(archivo as any, { tabla: 'servicios', confirmacion: 'IMPORTAR productos' } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(dbService.importar).not.toHaveBeenCalled();
  });

  it('con la confirmación exacta "IMPORTAR <tabla>" la importación pasa (servicio simulado)', async () => {
    const { controller, dbService } = makeController();
    const r = await controller.importar(archivo as any, {
      tabla: 'servicios',
      formato: 'json',
      modo: 'append',
      confirmacion: 'IMPORTAR servicios',
    } as any);
    expect(r).toEqual({ success: true, importados: 1 });
    expect(dbService.importar).toHaveBeenCalledWith('servicios', archivo, 'json', 'append');
  });

  it.each([
    'usuarios',
    'pagos',
    'pedidos',
    'pedido_items',
    'ventas_local',
    'ventas_local_items',
    'cortes_caja',
    'movimientos_caja',
    'devoluciones',
    'citas',
    'consentimientos',
    'versiones_documentos_legales',
    'solicitudes_arco',
    '_prisma_migrations',
    'solicitudes_cambio_correo',
    'sesiones_moviles',
    'historial_estados_pedido',
    'inventario_movimientos',
    'permisos_rol',
  ])('la tabla bloqueada %s responde 403 aunque venga la confirmación', async (tabla) => {
    const { controller, dbService } = makeController();
    const e = await controller
      .importar(archivo as any, { tabla, confirmacion: `IMPORTAR ${tabla}` } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(dbService.importar).not.toHaveBeenCalled();
  });
});
