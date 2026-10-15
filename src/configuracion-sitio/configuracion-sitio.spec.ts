import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { anticiposDesde } from '../citas/anticipos/anticipos.util';
import { ConfiguracionSitioService, PERMISO_CONFIGURACION, CATALOGO_PERMISOS } from './configuracion-sitio.service';
import { ConfiguracionPublicaController, ConfiguracionSitioController } from './configuracion-sitio.controller';
import { DIAS_SEMANA } from './horario.util';

/**
 * Configuración del sitio: una fila por sección (configuracion_sitio) e historial de cada cambio con el valor
 * anterior, quién y cuándo. Lectura pública sin sesión y con caché; edición solo con configuracion:editar.
 */
const SALON = {
  nombre: 'Mirú Franco Salón Beauty',
  responsable: 'Responsable de Prueba',
  direccion: 'Calle Uno No. 1, Col. Centro',
  ciudad: 'Huejutla de Reyes, Hidalgo',
  codigoPostal: '43000',
  telefono: '+52 771 000 0001',
  whatsapp: '+52 771 000 0002',
  correoContacto: 'contacto@example.com',
  correoPrivacidad: 'privacidad@example.com',
  mapaUrl: '',
  lema: 'Lema del salón.',
  descripcionSeo: 'Descripción del salón.',
};
const horario = (cambio: Record<string, unknown> = {}) =>
  DIAS_SEMANA.map((dia) => ({ dia, cerrado: dia === 'domingo', abre: dia === 'domingo' ? '' : '09:30', cierra: dia === 'domingo' ? '' : '19:30', ...(cambio[dia] as object) }));

function montar(filas: Record<string, unknown> = { salon: SALON, redes: { instagram: '', facebook: '', tiktok: '', twitter: '' }, horario: { dias: horario() }, reglas: { anticiposDesde: null } }) {
  const datos = new Map<string, { clave: string; valor: unknown; tipo: string; actualizadoEn: Date; actualizadoPorId: string | null }>(
    Object.entries(filas).map(([clave, valor]) => [clave, { clave, valor, tipo: clave, actualizadoEn: new Date(), actualizadoPorId: null }]),
  );
  const historial: Record<string, unknown>[] = [];
  const permisos = new Map<string, string[]>([
    ['admin', ['*']],
    ['estilista', ['citas:escritura', 'caja:escritura', 'clave:antigua']],
    ['becario', ['citas:asignadas']],
  ]);
  const tx = {
    configuracionSitio: {
      findUnique: jest.fn(async ({ where }: any) => datos.get(where.clave) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const actual = datos.get(where.clave);
        const fila = { ...(actual ?? create), ...(actual ? update : {}), clave: where.clave, actualizadoEn: new Date() };
        datos.set(where.clave, fila);
        return fila;
      }),
    },
    historialConfiguracionSitio: { create: jest.fn(async ({ data }: any) => historial.push(data)) },
    permisoRol: {
      findUnique: jest.fn(async ({ where }: any) => (permisos.has(where.rol) ? { rol: where.rol, claves: permisos.get(where.rol) } : null)),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        permisos.set(where.rol, (permisos.has(where.rol) ? update : create).claves);
        return { rol: where.rol, claves: permisos.get(where.rol) };
      }),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = {
    ...tx,
    configuracionSitio: { ...tx.configuracionSitio, findMany: jest.fn(async () => [...datos.values()]) },
    historialConfiguracionSitio: { ...tx.historialConfiguracionSitio, findMany: jest.fn(async () => historial.map((h, i) => ({ id: i + 1, creadoEn: new Date(), ...h }))) },
    permisoRol: { ...tx.permisoRol, findMany: jest.fn(async () => [...permisos.entries()].map(([rol, claves]) => ({ rol, claves }))) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const servicio = new ConfiguracionSitioService(prisma as any);
  return { servicio, prisma, datos, historial, permisos };
}

describe('Configuración del sitio: guardar con validación e historial', () => {
  it('guarda la sección y deja en el historial el valor anterior, el nuevo y quién lo cambió', async () => {
    const { servicio, datos, historial } = montar();
    await servicio.guardar('salon', { ...SALON, telefono: '+52 771 999 9999' }, 'admin-1');
    expect((datos.get('salon')!.valor as any).telefono).toBe('+52 771 999 9999');
    expect(historial).toEqual([
      expect.objectContaining({ clave: 'salon', valorAnterior: SALON, valorNuevo: expect.objectContaining({ telefono: '+52 771 999 9999' }), actualizadoPorId: 'admin-1' }),
    ]);
  });

  it('marca si el cambio toca datos que también están en los documentos legales', async () => {
    const { servicio } = montar();
    await expect(servicio.guardar('salon', { ...SALON, telefono: '+52 771 999 9999' }, 'admin-1')).resolves.toMatchObject({ afectaDocumentosLegales: true });
    await expect(servicio.guardar('salon', { ...SALON, telefono: '+52 771 999 9999', lema: 'Otro lema.' }, 'admin-1')).resolves.toMatchObject({ afectaDocumentosLegales: false });
  });

  it.each([
    ['correo inválido', 'salon', { ...SALON, correoContacto: 'no-es-correo' }, 'correo de contacto'],
    ['código postal de 4 dígitos', 'salon', { ...SALON, codigoPostal: '4300' }, 'código postal'],
    ['nombre vacío', 'salon', { ...SALON, nombre: '   ' }, 'nombre'],
    ['nombre con signos que rompen el remitente del correo', 'salon', { ...SALON, nombre: 'Salón <otro@ejemplo.com>' }, 'nombre del salón no puede llevar'],
    ['nombre con salto de línea (encabezados de correo)', 'salon', { ...SALON, nombre: 'Salón\r\nBcc: otro@ejemplo.com' }, 'nombre del salón no puede llevar'],
    ['campo que no existe', 'salon', { ...SALON, otro: 'x' }, 'no se reconoce'],
    ['red social que no es de su dominio', 'redes', { instagram: 'https://ejemplo.com/salon', facebook: '', tiktok: '', twitter: '' }, 'Instagram'],
    ['horario que cierra antes de abrir', 'horario', { dias: horario({ lunes: { abre: '19:30', cierra: '09:30' } }) }, 'lunes debe abrir antes de cerrar'],
    ['horario con todos los días cerrados', 'horario', { dias: DIAS_SEMANA.map((dia) => ({ dia, cerrado: true, abre: '', cierra: '' })) }, 'al menos un día'],
    ['fecha de anticipos inválida', 'reglas', { anticiposDesde: '2026-13-40' }, 'fecha'],
    ['imagen con dirección relativa al protocolo (otro sitio)', 'contenido_sobre_nosotros', { titulo: 'Historia', parrafos: ['Uno.'], imagen: '//otro.sitio/foto.jpg', valores: [] }, 'Subir foto'],
  ])('%s: 400 en español y no guarda nada', async (_caso, clave, valor, texto) => {
    const { servicio, historial } = montar();
    const error = await servicio.guardar(clave, valor, 'admin-1').catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(error.getResponse())).toContain(texto);
    expect(historial).toHaveLength(0);
  });

  it('una sección que no existe: 400', async () => {
    const { servicio } = montar();
    await expect(servicio.guardar('otra', {}, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Configuración pública (sin sesión, con caché)', () => {
  it('devuelve las secciones públicas y si los anticipos están activos, y la segunda vez sale de la caché', async () => {
    const { servicio, prisma } = montar();
    const a = await servicio.publica();
    expect(a).toMatchObject({ salon: { nombre: 'Mirú Franco Salón Beauty' }, horario: { dias: expect.any(Array) }, anticiposActivos: expect.any(Boolean) });
    expect(a).not.toHaveProperty('reglas');
    await servicio.publica();
    expect(prisma.configuracionSitio.findMany).toHaveBeenCalledTimes(1);
  });

  it('al guardar se borra la caché: el sitio refleja el cambio sin deploy', async () => {
    const { servicio, prisma } = montar();
    await servicio.publica();
    await servicio.guardar('salon', { ...SALON, nombre: 'Nombre Nuevo' }, 'admin-1');
    expect((await servicio.publica()).salon).toMatchObject({ nombre: 'Nombre Nuevo' });
    expect(prisma.configuracionSitio.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('ANTICIPOS_DESDE: la configuración manda y la variable queda de respaldo', () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('con una fecha guardada, anticiposDesde la usa aunque la variable diga otra', async () => {
    process.env.ANTICIPOS_DESDE = '2026-01-01';
    const { servicio } = montar();
    await servicio.guardar('reglas', { anticiposDesde: '2026-11-01' }, 'admin-1');
    expect(anticiposDesde()?.toISOString().slice(0, 10)).toBe('2026-11-01');
  });

  it('sin fecha guardada (null) usa la variable de entorno como respaldo', async () => {
    process.env.ANTICIPOS_DESDE = '2026-01-01';
    const { servicio } = montar();
    await servicio.guardar('reglas', { anticiposDesde: null }, 'admin-1');
    expect(anticiposDesde()?.toISOString().slice(0, 10)).toBe('2026-01-01');
    delete process.env.ANTICIPOS_DESDE;
    expect(anticiposDesde()).toBeNull();
  });
});

describe('Permisos por rol', () => {
  it('el admin queda fijo en "*": no se puede editar', async () => {
    const { servicio } = montar();
    await expect(servicio.guardarPermisos('admin', ['citas:escritura'], 'admin-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('solo acepta claves del catálogo; las que no están en el catálogo y ya tenía el rol se conservan', async () => {
    const { servicio, permisos, historial } = montar();
    await expect(servicio.guardarPermisos('estilista', ['inventada:clave'], 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    await servicio.guardarPermisos('estilista', ['citas:escritura', 'galeria:gestionar'], 'admin-1');
    expect(permisos.get('estilista')!.sort()).toEqual(['citas:escritura', 'clave:antigua', 'galeria:gestionar']);
    expect(historial).toEqual([
      expect.objectContaining({ clave: 'permisos:estilista', valorAnterior: ['citas:escritura', 'caja:escritura', 'clave:antigua'], actualizadoPorId: 'admin-1' }),
    ]);
  });

  it('configuracion:editar no se puede asignar (solo admin)', () => {
    expect(CATALOGO_PERMISOS.map((c) => c.clave)).not.toContain('configuracion:editar');
    expect(CATALOGO_PERMISOS.map((c) => c.clave)).toEqual(expect.arrayContaining(['galeria:gestionar', 'galeria:lectura', 'reembolsos:gestionar']));
  });
});

describe('Rutas', () => {
  it('la edición exige sesión y configuracion:editar; la lectura pública no tiene guardias', () => {
    expect(PERMISO_CONFIGURACION).toBe('configuracion:editar');
    expect(Reflect.getMetadata(GUARDS_METADATA, ConfiguracionSitioController)).toContain(PermisosGuard);
    expect(Reflect.getMetadata('permisos', ConfiguracionSitioController)).toEqual(['configuracion:editar']);
    expect(Reflect.getMetadata(GUARDS_METADATA, ConfiguracionPublicaController) ?? []).toEqual([]);
  });
});

describe('Cableado del módulo', () => {
  it('AppModule importa ConfiguracionSitioModule con sus dos controladores y el servicio', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../app.module');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConfiguracionSitioModule } = require('./configuracion-sitio.module');
    expect(Reflect.getMetadata('imports', AppModule)).toContain(ConfiguracionSitioModule);
    expect(Reflect.getMetadata('controllers', ConfiguracionSitioModule)).toEqual(expect.arrayContaining([ConfiguracionPublicaController, ConfiguracionSitioController]));
    expect(Reflect.getMetadata('providers', ConfiguracionSitioModule)).toContain(ConfiguracionSitioService);
  });
});
