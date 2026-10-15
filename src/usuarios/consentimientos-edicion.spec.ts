import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

/**
 * Datos de salud (punto 3) y promociones (punto 4) en los guardados de la cuenta y en el alta hecha por el admin.
 * Prisma simulado con la transacción en un cliente tx SEPARADO: las escrituras del prisma raíz lanzan "fuera de
 * la transacción", así que escribir con this.prisma en lugar de tx (o sin transacción) hace fallar la prueba.
 */
const HASH_TERMINOS = '6105ab7970cb21bbc1f8c629bd7da5a9952061cbc83741c5eced5ea68d1b4d69';
const HASH_AVISO = 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd';
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Navegador de prueba' };
const TITULAR = { formulario: 'perfil' as const, contexto: CONTEXTO };
const PERSONAL = { formulario: 'admin-usuario' as const, contexto: CONTEXTO, registradoPorId: 'admin-1' };

const MENSAJE_SALUD_TITULAR = 'Para guardar tus alergias marca la casilla de datos de salud.';
const MENSAJE_SALUD_PERSONAL = 'Marca que la persona aceptó que registremos sus datos de salud.';
const MENSAJE_PROMOCIONES = 'Solo la persona puede aceptar recibir promociones.';

const VERSIONES = [
  { slug: 'terminos', version: '2.0', hashTexto: HASH_TERMINOS, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
  { slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: new Date('2026-10-14T00:00:00.000Z') },
];

function escenario(opciones: { actual?: { alergias: string | null; recibePromociones: boolean } | null; sinAviso?: boolean } = {}) {
  const actual = opciones.actual === undefined ? { alergias: null, recibePromociones: false } : opciones.actual;
  const fuera = (q: string) =>
    jest.fn(() => {
      throw new Error(`${q} fuera de la transacción`);
    });
  const versiones = jest.fn(async ({ where }: any) =>
    VERSIONES.filter((v) => !(opciones.sinAviso && v.slug === 'aviso-privacidad'))
      .filter((v) => v.slug === where.slug && (!where.version || v.version === where.version) && (!where.hashTexto || v.hashTexto === where.hashTexto))[0] ?? null,
  );
  const tx: any = {
    usuario: {
      findUnique: jest.fn(async () => actual),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: jest.fn(async ({ data }: any) => ({ id: 'u-nuevo', rol: 'cliente', ...data })),
    },
    consentimiento: {
      create: jest.fn(async ({ data }: any) => ({ id: BigInt(1), ...data })),
      createMany: jest.fn(async ({ data }: any) => ({ count: data.length })),
    },
    versionDocumentoLegal: { findFirst: versiones },
  };
  const prisma: any = {
    // Lecturas fuera de la transacción: la foto actual (validarFotoDelCliente) y si el correo ya existe (alta)
    usuario: { findUnique: jest.fn().mockResolvedValue(null), update: fuera('usuario.update'), create: fuera('usuario.create') },
    consentimiento: { create: fuera('consentimiento.create'), createMany: fuera('consentimiento.createMany') },
    versionDocumentoLegal: { findFirst: versiones },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const emailService = { sendOTPEmail: jest.fn().mockResolvedValue(undefined) };
  const servicio = new UsuariosService(prisma, emailService as any, {} as any, {} as any);
  return { servicio, prisma, tx };
}

/** El 400 lleva el mensaje, un code y el campo en errors (la web marca la casilla). */
async function error400(promesa: Promise<unknown>) {
  const e = await promesa.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(BadRequestException);
  return (e as BadRequestException).getResponse() as { message: string; code: string; errors: Record<string, string> };
}

function nadaEscrito(tx: any) {
  expect(tx.usuario.update).not.toHaveBeenCalled();
  expect(tx.usuario.create).not.toHaveBeenCalled();
  expect(tx.consentimiento.create).not.toHaveBeenCalled();
  expect(tx.consentimiento.createMany).not.toHaveBeenCalled();
}

const filas = (tx: any) => tx.consentimiento.create.mock.calls.map((c: any) => c[0].data);

describe('Punto 3: alergias nuevas exigen consienteDatosSensibles === true', () => {
  describe.each([
    ['actualizarPerfilUsuario (PATCH /auth/me, PUT /usuarios/:id/perfil)', 'actualizarPerfilUsuario'],
    ['actualizarUsuario (PUT /usuarios/:id)', 'actualizarUsuario'],
  ] as const)('%s', (_n, metodo) => {
    const guardar = (s: UsuariosService, id: string, cuerpo: any, evidencia: any) => (s as any)[metodo](id, cuerpo, evidencia);

    it.each([
      ['sin la casilla', { alergias: 'Látex' }],
      ['con la casilla en false', { alergias: 'Látex', consienteDatosSensibles: false }],
      ['dentro de perfilCapilar y sin la casilla', { perfilCapilar: { alergias: 'Látex' } }],
    ])('la titular, %s: 400 con el mensaje para la titular y no se guarda nada', async (_c, cuerpo) => {
      const { servicio, tx } = escenario();
      const r = await error400(guardar(servicio, 'u-1', cuerpo, TITULAR));
      expect(r).toMatchObject({ message: MENSAJE_SALUD_TITULAR, code: 'CONSENTIMIENTO_SALUD_REQUERIDO', errors: { consienteDatosSensibles: MENSAJE_SALUD_TITULAR } });
      nadaEscrito(tx);
    });

    it('el personal, sin la casilla: 400 con el mensaje para el personal y no se guarda nada', async () => {
      const { servicio, tx } = escenario();
      const r = await error400(guardar(servicio, 'u-2', { alergias: 'Amoniaco' }, PERSONAL));
      expect(r).toMatchObject({ message: MENSAJE_SALUD_PERSONAL, errors: { consienteDatosSensibles: MENSAJE_SALUD_PERSONAL } });
      nadaEscrito(tx);
    });

    it('la titular con la casilla: guarda y registra datos_salud aceptado (aviso vigente, "perfil", "/perfil", sin registradoPorId) en la misma transacción', async () => {
      const { servicio, tx, prisma } = escenario();
      await guardar(servicio, 'u-1', { alergias: 'Látex', consienteDatosSensibles: true }, TITULAR);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.usuario.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u-1' }, data: { alergias: 'Látex' } });
      expect(tx.usuario.update.mock.calls[0][0].data).not.toHaveProperty('consienteDatosSensibles');
      expect(filas(tx)).toEqual([
        expect.objectContaining({
          usuarioId: 'u-1',
          tipo: 'datos_salud',
          accion: 'aceptado',
          documentoSlug: 'aviso-privacidad',
          documentoVersion: '2.0',
          documentoHash: HASH_AVISO,
          formulario: 'perfil',
          rutaOrigen: '/perfil',
          ip: CONTEXTO.ip,
          userAgent: CONTEXTO.userAgent,
          metodo: 'casilla_marcada',
        }),
      ]);
      expect(filas(tx)[0].registradoPorId ?? null).toBeNull();
    });

    it('el personal con la casilla: la fila queda a nombre de la persona con registradoPorId de quien guarda, "admin-usuario" y la ruta del panel', async () => {
      const { servicio, tx } = escenario();
      await guardar(servicio, 'u-2', { perfilCapilar: { alergias: 'Amoniaco' }, consienteDatosSensibles: true }, PERSONAL);
      expect(filas(tx)).toEqual([
        expect.objectContaining({ usuarioId: 'u-2', tipo: 'datos_salud', accion: 'aceptado', formulario: 'admin-usuario', rutaOrigen: '/admin/usuarios-roles', registradoPorId: 'admin-1' }),
      ]);
    });

    it('el personal: la rutaOrigen que manda el panel se guarda (y no llega a la cuenta)', async () => {
      const { servicio, tx } = escenario();
      await guardar(servicio, 'u-2', { alergias: 'Amoniaco', consienteDatosSensibles: true, rutaOrigen: '/admin/clientes-crm/u-2/editar' }, PERSONAL);
      expect(filas(tx)[0].rutaOrigen).toBe('/admin/clientes-crm/u-2/editar');
      expect(tx.usuario.update.mock.calls[0][0].data).not.toHaveProperty('rutaOrigen');
    });

    it.each([
      ['las mismas alergias, sin la casilla', { alergias: 'Látex' }],
      ['las mismas alergias con espacios, con la casilla', { alergias: '  Látex ', consienteDatosSensibles: true }],
      ['quitar las alergias (null)', { alergias: null }],
      ['quitar las alergias (vacío)', { alergias: '' }],
      ['sin alergias en el cuerpo', { nombre: 'Ana' }],
    ])('%s: guarda sin pedir la casilla y sin otra fila', async (_c, cuerpo) => {
      const { servicio, tx } = escenario({ actual: { alergias: 'Látex', recibePromociones: false } });
      await guardar(servicio, 'u-1', cuerpo, TITULAR);
      expect(tx.usuario.update).toHaveBeenCalledTimes(1);
      expect(tx.consentimiento.create).not.toHaveBeenCalled();
    });

    it('si falla el registro del consentimiento, falla el guardado (misma transacción)', async () => {
      const { servicio, tx } = escenario();
      tx.consentimiento.create.mockRejectedValueOnce(new Error('falla simulada'));
      await expect(guardar(servicio, 'u-1', { alergias: 'Látex', consienteDatosSensibles: true }, TITULAR)).rejects.toThrow('falla simulada');
    });

    it('sin una versión publicada del aviso: error del servidor antes de guardar (no queda una fila sin documento)', async () => {
      const { servicio, tx } = escenario({ sinAviso: true });
      await expect(guardar(servicio, 'u-1', { alergias: 'Látex', consienteDatosSensibles: true }, TITULAR)).rejects.toBeInstanceOf(InternalServerErrorException);
      nadaEscrito(tx);
    });

    it('cuenta inexistente: 404', async () => {
      const { servicio, tx } = escenario({ actual: null });
      await expect(guardar(servicio, 'u-x', { nombre: 'Ana' }, TITULAR)).rejects.toBeInstanceOf(NotFoundException);
      nadaEscrito(tx);
    });
  });
});

describe('Punto 4: recibePromociones en la edición deja su fila', () => {
  describe.each([
    ['actualizarPerfilUsuario', 'actualizarPerfilUsuario'],
    ['actualizarUsuario', 'actualizarUsuario'],
  ] as const)('%s', (_n, metodo) => {
    const guardar = (s: UsuariosService, id: string, cuerpo: any, evidencia: any) => (s as any)[metodo](id, cuerpo, evidencia);

    it.each([
      [false, true, 'aceptado'],
      [true, false, 'revocado'],
    ])('la titular lo cambia de %s a %s: fila promociones %s ("perfil", "/perfil", aviso vigente) en la misma transacción', async (antes, despues, accion) => {
      const { servicio, tx } = escenario({ actual: { alergias: null, recibePromociones: antes } });
      await guardar(servicio, 'u-1', { recibePromociones: despues }, TITULAR);
      expect(tx.usuario.update.mock.calls[0][0].data).toMatchObject({ recibePromociones: despues });
      expect(filas(tx)).toEqual([
        expect.objectContaining({ usuarioId: 'u-1', tipo: 'promociones', accion, formulario: 'perfil', rutaOrigen: '/perfil', documentoSlug: 'aviso-privacidad', documentoHash: HASH_AVISO }),
      ]);
      expect(filas(tx)[0].registradoPorId ?? null).toBeNull();
    });

    it('el personal lo pone en false: fila revocado con registradoPorId de quien guarda', async () => {
      const { servicio, tx } = escenario({ actual: { alergias: null, recibePromociones: true } });
      await guardar(servicio, 'u-2', { recibePromociones: false }, PERSONAL);
      expect(filas(tx)).toEqual([
        expect.objectContaining({ usuarioId: 'u-2', tipo: 'promociones', accion: 'revocado', formulario: 'admin-usuario', registradoPorId: 'admin-1' }),
      ]);
    });

    it('el personal intenta cambiarlo de false a true: 400 "Solo la persona puede aceptar recibir promociones." y no se guarda nada', async () => {
      const { servicio, tx } = escenario({ actual: { alergias: null, recibePromociones: false } });
      const r = await error400(guardar(servicio, 'u-2', { nombre: 'Ana', recibePromociones: true }, PERSONAL));
      expect(r).toMatchObject({ message: MENSAJE_PROMOCIONES, code: 'PROMOCIONES_SOLO_TITULAR', errors: { recibePromociones: MENSAJE_PROMOCIONES } });
      nadaEscrito(tx);
    });

    it.each([
      ['titular, sigue en true', TITULAR, true],
      ['titular, sigue en false', TITULAR, false],
      ['personal, sigue en true (la ficha lo reenvía)', PERSONAL, true],
      ['personal, sigue en false', PERSONAL, false],
    ])('sin cambio (%s): guarda y no inserta fila', async (_c, evidencia, valor) => {
      const { servicio, tx } = escenario({ actual: { alergias: null, recibePromociones: valor } });
      await guardar(servicio, 'u-2', { recibePromociones: valor }, evidencia);
      expect(tx.usuario.update).toHaveBeenCalledTimes(1);
      expect(tx.consentimiento.create).not.toHaveBeenCalled();
    });

    it('alergias nuevas y promociones en el mismo guardado: dos filas en la misma transacción', async () => {
      const { servicio, tx, prisma } = escenario({ actual: { alergias: null, recibePromociones: false } });
      await guardar(servicio, 'u-1', { alergias: 'Látex', consienteDatosSensibles: true, recibePromociones: true }, TITULAR);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(filas(tx).map((f: any) => [f.tipo, f.accion])).toEqual([
        ['datos_salud', 'aceptado'],
        ['promociones', 'aceptado'],
      ]);
    });
  });
});

describe('Alta (POST /usuarios/registro): misma regla de salud; el admin deja sus filas con registradoPorId', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const REGISTRO = {
    nombre: 'Persona Nueva',
    email: 'nueva@example.com',
    telefono: '7710000000',
    password: 'Otra$Llave47',
    aceptaTerminos: true,
    aceptaAvisoPrivacidad: true,
  };
  const ADMIN = { permitirConfirmado: true, contexto: CONTEXTO, registradoPorId: 'admin-1' };
  const filasAlta = (tx: any) => tx.consentimiento.createMany.mock.calls[0][0].data;

  it('registro público con alergias sin la casilla: 400 con el mensaje para la titular y no se crea nada', async () => {
    const { servicio, tx } = escenario();
    const r = await error400(servicio.crearUsuario({ ...REGISTRO, perfilCapilar: { alergias: 'Látex' } } as any, { contexto: CONTEXTO }));
    expect(r).toMatchObject({ message: MENSAJE_SALUD_TITULAR, errors: { consienteDatosSensibles: MENSAJE_SALUD_TITULAR } });
    nadaEscrito(tx);
  });

  it('alta del admin: terminos y aviso_privacidad con registradoPorId del admin, "admin-usuario" y la página de alta del panel', async () => {
    const { servicio, tx } = escenario();
    await servicio.crearUsuario(REGISTRO as any, ADMIN);
    expect(tx.usuario.create.mock.calls[0][0].data).toMatchObject({ aceptaAvisoPrivacidad: true, recibePromociones: false });
    expect(filasAlta(tx)).toEqual([
      expect.objectContaining({ usuarioId: 'u-nuevo', tipo: 'terminos', documentoSlug: 'terminos', documentoVersion: '2.0', documentoHash: HASH_TERMINOS, registradoPorId: 'admin-1', formulario: 'admin-usuario', rutaOrigen: '/admin/usuarios-roles/nuevo' }),
      expect.objectContaining({ usuarioId: 'u-nuevo', tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', documentoHash: HASH_AVISO, registradoPorId: 'admin-1', formulario: 'admin-usuario' }),
    ]);
  });

  it('alta del admin con los documentos que manda la web: se validan y se guardan esas versiones', async () => {
    const { servicio, tx } = escenario();
    const documentos = [
      { slug: 'terminos', version: '2.0', hash: HASH_TERMINOS },
      { slug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO },
    ];
    await servicio.crearUsuario({ ...REGISTRO, documentos, rutaOrigen: '/admin/usuarios-roles/nuevo' } as any, ADMIN);
    expect(filasAlta(tx).map((f: any) => [f.tipo, f.documentoVersion, f.documentoHash])).toEqual([
      ['terminos', '2.0', HASH_TERMINOS],
      ['aviso_privacidad', '2.0', HASH_AVISO],
    ]);
  });

  it('alta del admin con alergias sin la casilla: 400 con el mensaje para el personal y no se crea nada', async () => {
    const { servicio, tx } = escenario();
    const r = await error400(servicio.crearUsuario({ ...REGISTRO, perfilCapilar: { alergias: 'Amoniaco' } } as any, ADMIN));
    expect(r).toMatchObject({ message: MENSAJE_SALUD_PERSONAL, errors: { consienteDatosSensibles: MENSAJE_SALUD_PERSONAL } });
    nadaEscrito(tx);
  });

  it('alta del admin con alergias y la casilla: datos_salud con registradoPorId del admin, en la misma transacción', async () => {
    const { servicio, tx, prisma } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, perfilCapilar: { alergias: 'Amoniaco' }, consienteDatosSensibles: true } as any, ADMIN);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(filasAlta(tx).map((f: any) => [f.tipo, f.registradoPorId])).toEqual([
      ['terminos', 'admin-1'],
      ['aviso_privacidad', 'admin-1'],
      ['datos_salud', 'admin-1'],
    ]);
  });

  it('alta del admin con recibePromociones: 400 "Solo la persona puede aceptar recibir promociones." y no se crea nada', async () => {
    const { servicio, tx } = escenario();
    const r = await error400(servicio.crearUsuario({ ...REGISTRO, recibePromociones: true } as any, ADMIN));
    expect(r).toMatchObject({ message: MENSAJE_PROMOCIONES, errors: { recibePromociones: MENSAJE_PROMOCIONES } });
    nadaEscrito(tx);
  });

  it('registro público: las filas no llevan registradoPorId', async () => {
    const { servicio, tx } = escenario();
    await servicio.crearUsuario({ ...REGISTRO, recibePromociones: true } as any, { contexto: CONTEXTO });
    for (const fila of filasAlta(tx)) expect(fila.registradoPorId ?? null).toBeNull();
    expect(filasAlta(tx).map((f: any) => f.formulario)).toEqual(['registro', 'registro', 'registro']);
  });
});

describe('UpdateUsuarioDto: rutaOrigen (pantalla del panel que guarda, para la evidencia)', () => {
  // Mismas opciones que la ValidationPipe global de main.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ValidationPipe } = require('@nestjs/common');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { UpdateUsuarioDto } = require('./dto/update-usuario.dto');
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const validar = (cuerpo: unknown) => pipe.transform(cuerpo, { type: 'body', metatype: UpdateUsuarioDto });

  it('acepta una ruta de hasta 300 caracteres', async () => {
    await expect(validar({ rutaOrigen: '/admin/clientes-crm/u-2/editar' })).resolves.toMatchObject({ rutaOrigen: '/admin/clientes-crm/u-2/editar' });
  });

  it('rechaza una ruta de más de 300 caracteres con 400', async () => {
    await expect(validar({ rutaOrigen: `/${'x'.repeat(300)}` })).rejects.toBeInstanceOf(BadRequestException);
  });
});
