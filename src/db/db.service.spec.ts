import { BadRequestException } from '@nestjs/common';
import { DbService } from './db.service';

function buildCsv(ids: number[], includeId = true): string {
  const headers = [
    ...(includeId ? ['id'] : []),
    'nombre',
    'precio',
    'categoria',
    'duracionMinutos',
    'requiereEvaluacion',
    'imagen',
    'incluye',
    'recomendaciones',
    'activo',
  ];
  const rows = ids.map((id) => {
    const values = [
      ...(includeId ? [String(id)] : []),
      `Servicio ${id}`,
      '100',
      'cabello',
      '60',
      'false',
      '[]',
      '[]',
      '[]',
      'true',
    ];
    return values.join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

function buildDireccionesCsv(ids: string[], includeId = true): string {
  const headers = [
    ...(includeId ? ['id'] : []),
    'usuarioId',
    'calle',
    'codigoPostal',
    'estado',
    'municipioAlcaldia',
    'localidad',
    'coloniaBarrio',
    'tipoDomicilio',
    'contactoNombreApellido',
    'contactoTelefono',
    'esPrincipal',
  ];
  const rows = ids.map((id, idx) => {
    const values = [
      ...(includeId ? [id] : []),
      `user-${idx + 1}`,
      'Av Siempre Viva',
      '01000',
      'CDMX',
      'Alvaro Obregon',
      'CDMX',
      'Florida',
      'casa',
      `Contacto ${idx + 1}`,
      '5512345678',
      'false',
    ];
    return values.join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

describe('DbService importar', () => {
  const makeService = () => {
    const tx = {
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      servicio: { create: jest.fn() },
      producto: { create: jest.fn() },
      usuario: { findUnique: jest.fn(), create: jest.fn() },
      direccionUsuario: { create: jest.fn() },
    };
    return { service: new DbService(prisma), prisma, tx };
  };

  it('Caso A: missing_only inserta solo faltantes', async () => {
    const { service, tx } = makeService();
    const existing = new Set(Array.from({ length: 90 }, (_, i) => i + 1));
    tx.$executeRawUnsafe.mockImplementation(async (_sql: string, ...values: any[]) => {
      const id = Number(values[0]);
      return existing.has(id) ? 0 : 1;
    });

    const csv = buildCsv(Array.from({ length: 100 }, (_, i) => i + 1));
    const res = await service.importar(
      'servicios',
      { buffer: Buffer.from(csv), originalname: 'servicios.csv', size: Buffer.byteLength(csv) },
      'csv',
      'missing_only',
    );

    expect(res.success).toBe(true);
    expect(res.importados).toBe(10);
    expect(res.fallidos).toBe(0);
    expect(res.insertados).toBe(10);
    expect(res.omitidos).toBe(90);
    expect(res.actualizados).toBe(0);
  });

  it('Caso B: upsert actualiza existentes sin duplicar', async () => {
    const { service, tx } = makeService();
    const existing = new Set([1, 2, 3, 4, 5]);
    tx.$queryRawUnsafe.mockImplementation(async (_sql: string, ...values: any[]) => {
      const id = Number(values[0]);
      return existing.has(id) ? [{ one: 1 }] : [];
    });
    tx.$executeRawUnsafe.mockResolvedValue(1);

    const csv = buildCsv([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const res = await service.importar(
      'servicios',
      { buffer: Buffer.from(csv), originalname: 'servicios.csv', size: Buffer.byteLength(csv) },
      'csv',
      'upsert',
    );

    expect(res.success).toBe(true);
    expect(res.importados).toBe(10);
    expect(res.fallidos).toBe(0);
    expect(res.actualizados).toBe(5);
    expect(res.insertados).toBe(5);
    expect(res.omitidos).toBe(0);
  });

  it('Caso C: missing_only sin id responde 400 claro', async () => {
    const { service } = makeService();
    const csv = buildCsv([1, 2], false);

    await expect(
      service.importar(
        'servicios',
        { buffer: Buffer.from(csv), originalname: 'servicios.csv', size: Buffer.byteLength(csv) },
        'csv',
        'missing_only',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('Caso D: append mantiene comportamiento actual', async () => {
    const { service, prisma } = makeService();
    prisma.servicio.create.mockResolvedValue({});
    const csv = buildCsv([1, 2, 3]);

    const res = await service.importar(
      'servicios',
      { buffer: Buffer.from(csv), originalname: 'servicios.csv', size: Buffer.byteLength(csv) },
      'csv',
      'append',
    );

    expect(res.success).toBe(true);
    expect(res.modo).toBe('append');
    expect(res.importados).toBe(3);
    expect(res.fallidos).toBe(0);
    expect(res.insertados).toBe(3);
    expect(res.actualizados).toBe(0);
    expect(res.omitidos).toBe(0);
  });

  it('direcciones_usuario soporta missing_only por id', async () => {
    const { service, tx } = makeService();
    const existing = new Set(['dir-1', 'dir-2']);
    tx.$executeRawUnsafe.mockImplementation(async (_sql: string, ...values: any[]) => {
      const id = String(values[0]);
      return existing.has(id) ? 0 : 1;
    });

    const csv = buildDireccionesCsv(['dir-1', 'dir-2', 'dir-3']);
    const res = await service.importar(
      'direcciones_usuario',
      { buffer: Buffer.from(csv), originalname: 'direcciones.csv', size: Buffer.byteLength(csv) },
      'csv',
      'missing_only',
    );

    expect(res.success).toBe(true);
    expect(res.insertados).toBe(1);
    expect(res.omitidos).toBe(2);
    expect(res.actualizados).toBe(0);
  });

  it('tabla no permitida responde 400', async () => {
    const { service } = makeService();
    const csv = buildCsv([1]);
    await expect(
      service.importar(
        'tokens_revocados',
        { buffer: Buffer.from(csv), originalname: 'x.csv', size: Buffer.byteLength(csv) },
        'csv',
        'append',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('usuarios/products no soportan modo conflictivo', async () => {
    const { service } = makeService();
    const csv = buildCsv([1]);
    await expect(
      service.importar(
        'usuarios',
        { buffer: Buffer.from(csv), originalname: 'usuarios.csv', size: Buffer.byteLength(csv) },
        'csv',
        'upsert',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.importar(
        'productos',
        { buffer: Buffer.from(csv), originalname: 'productos.csv', size: Buffer.byteLength(csv) },
        'csv',
        'missing_only',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

