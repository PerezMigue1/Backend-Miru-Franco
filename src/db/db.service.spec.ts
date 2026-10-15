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

describe('DbService: exportación CSV sin fórmulas', () => {
  it('un texto que empieza con =, +, - o @ sale con comilla simple delante', async () => {
    const prisma: any = {
      servicio: {
        findMany: jest.fn(async () => [
          { id: 1, nombre: '=HYPERLINK("http://x")', descripcion: '@SUM(A1)', descripcionLarga: '-2+3', categoria: '+cabello', precio: 100, duracionMinutos: 60, activo: true },
        ]),
      },
    };
    const { buffer } = await new DbService(prisma).exportar('servicios', 'csv');
    const fila = `,${buffer.toString('utf-8').split('\n')[1]},`;
    for (const valor of [`"'=HYPERLINK(""http://x"")"`, "'@SUM(A1)", "'-2+3", "'+cabello", '100', '60']) {
      expect(fila).toContain(`,${valor},`);
    }
    expect(fila).not.toMatch(/,[=+\-@]/);
  });
});

describe('DbService: truncate', () => {
  it('responde en español', async () => {
    const prisma: any = { $queryRawUnsafe: jest.fn(async () => [{ exists: true }]), $executeRawUnsafe: jest.fn(async () => 0) };
    const r = await new DbService(prisma).truncateTable({ tabla: 'servicios', confirmacion: 'TRUNCATE servicios' } as any);
    expect(r.message).toBe('Se vació la tabla servicios');
  });
});

describe('DbService: exportaciones sin secretos ni datos de salud (punto 13)', () => {
  const usuarioCompleto = {
    id: 'u-1',
    nombre: 'Ana',
    email: 'ana@example.com',
    telefono: '5599887766',
    rol: 'cliente',
    activo: true,
    confirmado: true,
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    password: 'hash-secreto-bcrypt',
    resetPasswordToken: 'token-de-reset',
    codigoOTP: '123456',
    preguntaSeguridad: '¿Mascota?',
    respuestaSeguridad: 'hash-de-respuesta',
    alergias: 'polen',
    tratamientos: 'keratina',
    tratamientosQuimicos: true,
    tipoCabello: 'liso',
    colorNatural: 'negro',
    colorActual: 'rojo',
    productosUsados: 'shampoo x',
  };

  it('exportar usuarios (JSON y CSV) no contiene password, tokens, OTP, respuesta de seguridad ni datos de salud', async () => {
    const prisma: any = { usuario: { findMany: jest.fn(async () => [usuarioCompleto]) } };
    const service = new DbService(prisma);
    for (const formato of ['json', 'csv'] as const) {
      const { buffer } = await service.exportar('usuarios', formato);
      const texto = buffer.toString('utf-8');
      for (const prohibido of [
        'password',
        'hash-secreto-bcrypt',
        'resetPasswordToken',
        'token-de-reset',
        'codigoOTP',
        '123456',
        'respuestaSeguridad',
        'hash-de-respuesta',
        'alergias',
        'polen',
        'tratamientos',
        'keratina',
        'tipoCabello',
        'colorNatural',
        'colorActual',
        'productosUsados',
      ]) {
        expect(texto).not.toContain(prohibido);
      }
      expect(texto).toContain('ana@example.com');
    }
  });

  it('el respaldo completo sí contiene alergias (datos de salud) pero nunca password ni tokens', async () => {
    const prisma: any = {
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return [
            { table_name: 'usuarios' },
            { table_name: 'codigos_oauth' },
            { table_name: 'solicitudes_cambio_correo' },
            { table_name: '_prisma_migrations' },
          ];
        }
        if (sql.includes('"usuarios"')) {
          return [
            {
              id: 'u-1',
              email: 'ana@example.com',
              password: 'hash-secreto-bcrypt',
              codigoOTP: '123456',
              resetPasswordToken: 'token-de-reset',
              respuesta_seguridad: 'hash-de-respuesta',
              alergias: 'polen',
              tipoCabello: 'liso',
              color_natural: 'negro',
            },
          ];
        }
        if (sql.includes('"solicitudes_cambio_correo"')) {
          return [{ id: 3, correo_nuevo: 'nuevo@example.com', codigo_hash: 'valor-secreto-hash-del-codigo' }];
        }
        return [{ id: 1, codigo: 'codigo-oauth-canjeable', token: 'jwt-secretisimo' }];
      }),
    };
    const { buffer, filename, contentType } = await new DbService(prisma).respaldoCompleto();
    const texto = buffer.toString('utf-8');

    expect(contentType).toBe('application/json');
    expect(filename).toMatch(/respaldo/);
    // Datos de salud: SOLO aquí (respaldo integral, solo admin).
    expect(texto).toContain('alergias');
    expect(texto).toContain('polen');
    expect(texto).toContain('tipoCabello');
    expect(texto).toContain('color_natural');
    // Secretos: nunca, ni aquí.
    for (const prohibido of [
      'password',
      'hash-secreto-bcrypt',
      'codigoOTP',
      '123456',
      'resetPasswordToken',
      'token-de-reset',
      'respuesta_seguridad',
      'hash-de-respuesta',
      '"token"',
      'jwt-secretisimo',
      // Códigos de un solo uso: el de OAuth se canjea por la sesión mientras está vigente
      '"codigo"',
      'codigo-oauth-canjeable',
      'codigo_hash',
      'hash-del-codigo',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    // Las tablas llegan completas (menos columnas secretas) y _prisma_migrations no se respalda.
    expect(texto).toContain('codigos_oauth');
    expect(texto).toContain('nuevo@example.com');
    expect(texto).not.toContain('_prisma_migrations');
  });
});

describe('DbService: truncate con confirmación y tablas bloqueadas (punto 14)', () => {
  const prismaTruncate = () =>
    ({ $queryRawUnsafe: jest.fn(async () => [{ exists: true }]), $executeRawUnsafe: jest.fn(async () => 0) }) as any;

  it.each([
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
    'usuarios',
    '_prisma_migrations',
    // Identidad de sesión, evidencia del art. 56, kardex y permisos
    'solicitudes_cambio_correo',
    'sesiones_moviles',
    'historial_estados_pedido',
    'inventario_movimientos',
    'permisos_rol',
  ])('truncate de %s (tabla bloqueada) responde 400 con mensaje claro y no toca la base', async (tabla) => {
    const prisma = prismaTruncate();
    const e = await new DbService(prisma)
      .truncateTable({ tabla, confirmacion: `TRUNCATE ${tabla}` } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toContain(tabla);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('tabla permitida sin confirmación responde 400 en español y no trunca', async () => {
    const prisma = prismaTruncate();
    const e = await new DbService(prisma).truncateTable({ tabla: 'servicios' } as any).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toContain('TRUNCATE servicios');
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('con otra confirmación ("TRUNCATE otra_tabla") también responde 400', async () => {
    const prisma = prismaTruncate();
    const e = await new DbService(prisma)
      .truncateTable({ tabla: 'servicios', confirmacion: 'TRUNCATE productos' } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('con la confirmación exacta sí trunca (prisma simulado)', async () => {
    const prisma = prismaTruncate();
    const r = await new DbService(prisma).truncateTable({
      tabla: 'servicios',
      confirmacion: 'TRUNCATE servicios',
    } as any);
    expect(r.success).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe('DbService: truncate con cascade no alcanza tablas bloqueadas (punto 14)', () => {
  /**
   * Prisma simulado: la tabla existe y la consulta recursiva de llaves foráneas (pg_constraint)
   * devuelve las tablas que TRUNCATE ... CASCADE vaciaría junto con la pedida.
   */
  const prismaConDependientes = (dependientes: string[]) =>
    ({
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes('pg_constraint')) {
          return dependientes.map((tabla) => ({ esquema: 'public', tabla }));
        }
        return [{ exists: true }];
      }),
      $executeRawUnsafe: jest.fn(async () => 0),
    }) as any;

  it('truncate de servicios con cascade, que tiene a citas (y en cadena pagos) como dependiente, responde 400 y no trunca', async () => {
    const prisma = prismaConDependientes(['citas', 'pagos', 'movimientos_caja', 'devoluciones', 'ventas_local_items']);
    const e = await new DbService(prisma)
      .truncateTable({ tabla: 'servicios', confirmacion: 'TRUNCATE servicios', cascade: true } as any)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toContain('citas');
    expect((e as BadRequestException).message).toContain('pagos');
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('la revisión de dependientes es recursiva sobre pg_constraint y recibe la tabla como parámetro', async () => {
    const prisma = prismaConDependientes(['citas']);
    await new DbService(prisma)
      .truncateTable({ tabla: 'servicios', confirmacion: 'TRUNCATE servicios', cascade: true } as any)
      .catch(() => undefined);
    const llamada = prisma.$queryRawUnsafe.mock.calls.find(([sql]: [string]) => sql.includes('pg_constraint'));
    expect(llamada).toBeDefined();
    expect(llamada[0]).toMatch(/WITH RECURSIVE/i);
    expect(llamada[0]).not.toContain('servicios');
    expect(llamada.slice(1)).toEqual(['servicios']);
  });

  it('cascade sobre una tabla cuyos dependientes son todos permitidos sí trunca con CASCADE', async () => {
    const prisma = prismaConDependientes(['servicio_productos']);
    const r = await new DbService(prisma).truncateTable({
      tabla: 'servicios',
      confirmacion: 'TRUNCATE servicios',
      cascade: true,
    } as any);
    expect(r.cascade).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'TRUNCATE TABLE "public"."servicios" RESTART IDENTITY CASCADE;',
    );
  });
});

describe('DbService: importación de tablas bloqueadas (sesiones, códigos, evidencia y permisos)', () => {
  it.each(['solicitudes_cambio_correo', 'sesiones_moviles', 'historial_estados_pedido', 'inventario_movimientos', 'permisos_rol'])(
    'importar %s responde 400 "tabla bloqueada por seguridad" sin leer el archivo ni tocar la base',
    async (tabla) => {
      const prisma: any = { $queryRawUnsafe: jest.fn(async () => [{ exists: true }]), $executeRawUnsafe: jest.fn(async () => 0) };
      const archivo = { buffer: Buffer.from('[{"id":1}]'), originalname: 'x.json', size: 10 };
      const e = await new DbService(prisma).importar(tabla, archivo, 'json', 'append').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).message).toBe('tabla bloqueada por seguridad');
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    },
  );
});

describe('DbService: importación de usuarios sin datos que exigen consentimiento con evidencia', () => {
  /** La ruta pública bloquea importar usuarios; esto cubre el camino interno (importarAppend) por si se habilita. */
  const prismaUsuarios = () => {
    const prisma: any = {
      usuario: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })) },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    return prisma;
  };

  it('no importa alergias ni la aceptación del aviso ni las promociones, y lo dice en la respuesta', async () => {
    const prisma = prismaUsuarios();
    const r = await (new DbService(prisma) as any).importarAppend('usuarios', [
      { nombre: 'Ana', email: 'ana@example.com', alergias: 'Látex', aceptaAvisoPrivacidad: 'true', recibePromociones: true },
    ]);
    const data = prisma.usuario.create.mock.calls[0][0].data;
    expect(data.alergias ?? null).toBeNull();
    expect(data).toMatchObject({ aceptaAvisoPrivacidad: false, recibePromociones: false });
    expect(r).toMatchObject({ success: true, insertados: 1 });
    expect(r.avisos).toEqual([expect.stringContaining('alergias')]);
  });

  it('sin esos datos en el archivo, la respuesta no lleva avisos', async () => {
    const prisma = prismaUsuarios();
    const r = await (new DbService(prisma) as any).importarAppend('usuarios', [{ nombre: 'Ana', email: 'ana@example.com' }]);
    expect(r.avisos).toBeUndefined();
  });
});
