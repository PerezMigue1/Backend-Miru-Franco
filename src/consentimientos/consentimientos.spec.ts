import { BadRequestException, CanActivate, ExecutionContext, INestApplication, InternalServerErrorException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { SesionOpcionalGuard } from '../auth/sesion-opcional.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentimientosService } from './consentimientos.service';
import { ipDeRequest } from './documentos-legales';

/**
 * Consentimientos: evidencia de solo inserción. Cada fila guarda documento (slug, versión y hash), ip,
 * user agent, formulario y ruta; la fecha la pone la base. Revocar es insertar otra fila. Prisma simulado.
 */

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConsentimientosController } = require('./consentimientos.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RateLimitGuard } = require('../common/guards/rate-limit.guard');

const HASH_TERMINOS = '6105ab7970cb21bbc1f8c629bd7da5a9952061cbc83741c5eced5ea68d1b4d69';
const HASH_AVISO = 'fae1b55c1fc51ab41088fdfdf8bb1ab4a84ad7a9eeca1d050e88cb1d100ef1bd';
const HASH_COOKIES = '48a413af84c7421848e67d8cecb4adae5fdcfb020157a62c999e6e96c4c5d083';
const HASH_TERMINOS_3 = 'b'.repeat(64);
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Mozilla/5.0 (prueba)' };

const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);

function prismaFalso(opciones: { versionesExtra?: any[] } = {}) {
  const versiones = [
    { id: 1, slug: 'terminos', version: '1.0', hashTexto: 'c'.repeat(64), vigenteDesde: dia('2025-01-01') },
    { id: 2, slug: 'terminos', version: '2.0', hashTexto: HASH_TERMINOS, vigenteDesde: dia('2026-10-14') },
    { id: 3, slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: dia('2026-10-14') },
    { id: 4, slug: 'cookies', version: '1.0', hashTexto: HASH_COOKIES, vigenteDesde: dia('2026-10-14') },
    ...(opciones.versionesExtra ?? []),
  ];
  const filas: any[] = [];
  let siguiente = BigInt(1);
  const soloInsercion = () => {
    throw new Error('consentimientos es de solo inserción');
  };
  const coincide = (f: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'lte' in v) return f[k] <= v.lte;
      if (v === null) return f[k] == null;
      return f[k] === v;
    });
  const ordenar = (lista: any[], orderBy: any) => {
    const criterios = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...lista].sort((a, b) => {
      for (const c of criterios) {
        const [campo, dir] = Object.entries(c)[0] as [string, string];
        if (a[campo] < b[campo]) return dir === 'desc' ? 1 : -1;
        if (a[campo] > b[campo]) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  };
  const prisma: any = {
    filas,
    versionDocumentoLegal: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => ordenar(versiones.filter((v) => coincide(v, where)), orderBy)[0] ?? null),
    },
    consentimiento: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: siguiente, creadoEn: new Date(Date.now() + Number(siguiente)), metodo: 'casilla_marcada', usuarioId: null, visitanteId: null, ...data };
        siguiente += BigInt(1);
        filas.push(fila);
        return { ...fila };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) await prisma.consentimiento.create({ data: d });
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: any = {}) => {
        const lista = ordenar(filas.filter((f) => !where || !where.usuarioId || f.usuarioId === where.usuarioId), orderBy);
        return lista.slice(skip, take ? skip + take : undefined).map((f) => ({ ...f }));
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => ordenar(filas.filter((f) => coincide(f, where)), orderBy)[0] ?? null),
      count: jest.fn(async () => filas.length),
      update: jest.fn(soloInsercion),
      updateMany: jest.fn(soloInsercion),
      upsert: jest.fn(soloInsercion),
      delete: jest.fn(soloInsercion),
      deleteMany: jest.fn(soloInsercion),
    },
    usuario: { update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
    galeriaFoto: { updateMany: jest.fn(async () => ({ count: 0 })) },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
}

const montar = (opciones?: { versionesExtra?: any[] }) => {
  const prisma = prismaFalso(opciones);
  return { prisma, servicio: new ConsentimientosService(prisma) };
};

const aceptarTerminos = { tipo: 'terminos', documentoSlug: 'terminos', version: '2.0', hash: HASH_TERMINOS, accion: 'aceptado' } as const;

describe('ConsentimientosService.registrar', () => {
  it('cada fila guarda documento, versión, hash, ip, user agent, formulario, ruta y método; la fecha la pone la base', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.registrar(
      { items: [aceptarTerminos], formulario: 'perfil_privacidad', rutaOrigen: '/perfil/privacidad' },
      { usuarioId: 'u-1' },
      CONTEXTO,
    );
    const data = prisma.consentimiento.create.mock.calls[0][0].data;
    expect(data).toEqual({
      usuarioId: 'u-1',
      visitanteId: null,
      tipo: 'terminos',
      documentoSlug: 'terminos',
      documentoVersion: '2.0',
      documentoHash: HASH_TERMINOS,
      accion: 'aceptado',
      ip: CONTEXTO.ip,
      userAgent: CONTEXTO.userAgent,
      formulario: 'perfil_privacidad',
      rutaOrigen: '/perfil/privacidad',
      metodo: 'casilla_marcada',
    });
    expect(data).not.toHaveProperty('creadoEn');
    // La respuesta trae la fecha de la base y el id BigInt como texto (JSON no serializa BigInt)
    expect(r.success).toBe(true);
    expect(r.data[0]).toMatchObject({ id: '1', documentoVersion: '2.0', documentoHash: HASH_TERMINOS });
    expect(r.data[0].creadoEn).toBeInstanceOf(Date);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it.each([
    ['versión desconocida', { ...aceptarTerminos, version: '9.9' }],
    ['hash que no coincide', { ...aceptarTerminos, hash: 'd'.repeat(64) }],
    ['slug de otro documento para el tipo', { ...aceptarTerminos, documentoSlug: 'cookies', version: '1.0', hash: HASH_COOKIES }],
    ['aceptar terminos sin documento', { tipo: 'terminos', accion: 'aceptado' }],
    ['documento incompleto (sin hash)', { tipo: 'promociones', documentoSlug: 'aviso-privacidad', version: '2.0', accion: 'aceptado' }],
  ])('%s: 400 y no se inserta nada', async (_caso, item) => {
    const { servicio, prisma } = montar();
    await expect(servicio.registrar({ items: [item as any], formulario: 'registro' }, { usuarioId: 'u-1' }, CONTEXTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.consentimiento.create).not.toHaveBeenCalled();
    expect(prisma.consentimiento.createMany).not.toHaveBeenCalled();
  });

  it('si un elemento es inválido no se guarda ninguno (todo o nada)', async () => {
    const { servicio, prisma } = montar();
    await expect(
      servicio.registrar({ items: [aceptarTerminos, { ...aceptarTerminos, version: '9.9' }], formulario: 'registro' }, { usuarioId: 'u-1' }, CONTEXTO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.filas).toHaveLength(0);
  });

  it.each([
    ['promociones', 'aceptado'],
    ['promociones', 'revocado'],
    ['datos_salud', 'aceptado'],
    ['datos_salud', 'revocado'],
    ['fotos_resultado', 'aceptado'],
    ['fotos_resultado', 'revocado'],
  ])('%s %s sin documento: se liga a la versión vigente del aviso de privacidad (que describe esa finalidad)', async (tipo, accion) => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo, accion } as any], formulario: 'crear-cita' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas[0]).toMatchObject({ tipo, accion, documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO });
  });

  it('terminos_venta sin documento: se liga a la versión vigente de los Términos', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'terminos_venta', accion: 'aceptado' }], formulario: 'checkout' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas[0]).toMatchObject({ tipo: 'terminos_venta', documentoSlug: 'terminos', documentoVersion: '2.0', documentoHash: HASH_TERMINOS });
  });

  it('terminos_venta con el documento de los Términos (lo que manda el checkout) guarda esa versión', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ ...aceptarTerminos, tipo: 'terminos_venta' }], formulario: 'checkout' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas[0]).toMatchObject({ tipo: 'terminos_venta', documentoSlug: 'terminos', documentoVersion: '2.0', documentoHash: HASH_TERMINOS });
  });

  const COOKIES = { documentoSlug: 'cookies', version: '1.0', hash: HASH_COOKIES };
  const AVISO = { documentoSlug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO };
  it.each([
    ['terminos_venta con el documento de cookies', { tipo: 'terminos_venta', ...COOKIES }, 'terminos'],
    ['promociones con el documento de cookies', { tipo: 'promociones', ...COOKIES }, 'aviso-privacidad'],
    ['datos_salud con el documento de cookies', { tipo: 'datos_salud', ...COOKIES }, 'aviso-privacidad'],
    ['fotos_resultado con los Términos', { tipo: 'fotos_resultado', documentoSlug: 'terminos', version: '2.0', hash: HASH_TERMINOS }, 'aviso-privacidad'],
    ['reembolsos con el aviso de privacidad', { tipo: 'reembolsos', ...AVISO }, 'reembolsos'],
    ['anticipos con el aviso de privacidad', { tipo: 'anticipos', ...AVISO }, 'anticipos'],
  ])('%s: 400 "corresponde al documento" y no se inserta nada', async (_caso, item, slug) => {
    const { servicio, prisma } = montar();
    const e = await servicio
      .registrar({ items: [{ ...item, accion: 'aceptado' } as any], formulario: 'x' }, { usuarioId: 'u-1' }, CONTEXTO)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toContain(`corresponde al documento "${slug}"`);
    expect(prisma.filas).toHaveLength(0);
  });

  it('promociones con el aviso de privacidad que manda la web guarda esa versión', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'aceptado', ...AVISO } as any], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas[0]).toMatchObject({ documentoSlug: 'aviso-privacidad', documentoVersion: '2.0', documentoHash: HASH_AVISO });
  });

  it('sin una versión publicada del aviso de privacidad, promociones no se registra sin documento (error del servidor, nada insertado)', async () => {
    const prisma = prismaFalso();
    prisma.versionDocumentoLegal.findFirst = jest.fn(async ({ where }: any) => (where.slug === 'aviso-privacidad' ? null : { slug: where.slug, version: '2.0', hashTexto: HASH_TERMINOS, vigenteDesde: dia('2026-10-14') }));
    const e = await new ConsentimientosService(prisma)
      .registrar({ items: [{ tipo: 'promociones', accion: 'aceptado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InternalServerErrorException);
    expect(prisma.filas).toHaveLength(0);
  });

  it.each([
    ['perfil', '/perfil'],
    ['perfil_privacidad', '/perfil'],
  ])('formulario "%s" sin rutaOrigen guarda la ruta conocida %s', async (formulario, ruta) => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'revocado' }], formulario }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas[0].rutaOrigen).toBe(ruta);
  });

  it('la rutaOrigen del cuerpo gana; un formulario sin ruta conocida y sin rutaOrigen queda en null', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'revocado' }], formulario: 'perfil', rutaOrigen: '/perfil#privacidad' }, { usuarioId: 'u-1' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'revocado' }], formulario: 'otra_pantalla' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas.map((f: any) => f.rutaOrigen)).toEqual(['/perfil#privacidad', null]);
  });

  it('sin sesión exige visitanteId (400) y con él guarda al visitante sin usuario', async () => {
    const { servicio, prisma } = montar();
    const cookies = { tipo: 'cookies', documentoSlug: 'cookies', version: '1.0', hash: HASH_COOKIES, accion: 'aceptado' } as const;
    await expect(servicio.registrar({ items: [cookies], formulario: 'banner_cookies' }, { usuarioId: null }, CONTEXTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await servicio.registrar({ items: [cookies], formulario: 'banner_cookies', visitanteId: 'visitante-123456' }, { usuarioId: null }, CONTEXTO);
    expect(prisma.filas).toHaveLength(1);
    expect(prisma.filas[0]).toMatchObject({ usuarioId: null, visitanteId: 'visitante-123456', tipo: 'cookies' });
  });

  it('revocar inserta una fila nueva con accion "revocado": la aceptada queda intacta', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'aceptado' }], formulario: 'registro' }, { usuarioId: 'u-1' }, CONTEXTO);
    const aceptada = { ...prisma.filas[0] };
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.filas).toHaveLength(2);
    expect(prisma.filas[0]).toEqual(aceptada);
    expect(prisma.filas[1]).toMatchObject({ tipo: 'promociones', accion: 'revocado', usuarioId: 'u-1' });
    expect(prisma.consentimiento.update).not.toHaveBeenCalled();
    expect(prisma.consentimiento.delete).not.toHaveBeenCalled();
  });

  it('revocar promociones pone recibePromociones=false; aceptarlas, true', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.usuario.update).toHaveBeenLastCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: false } });
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'aceptado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.usuario.update).toHaveBeenLastCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: true } });
  });

  it('revocar datos_salud borra los campos de salud de la usuaria (sin efectos retroactivos en la evidencia)', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'datos_salud', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { alergias: null } });
    expect(prisma.filas[0]).toMatchObject({ tipo: 'datos_salud', accion: 'revocado' });
  });

  it('sin sesión (visitante) no toca ninguna cuenta', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'revocado' }], formulario: 'banner', visitanteId: 'visitante-123456' }, { usuarioId: null }, CONTEXTO);
    expect(prisma.usuario.update).not.toHaveBeenCalled();
  });

  it('revocar fotos_resultado oculta en la galería las fotos ligadas a sus autorizaciones, en la misma transacción', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect(prisma.galeriaFoto.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.galeriaFoto.updateMany).toHaveBeenCalledWith({
      where: { visible: true, consentimiento: { is: { usuarioId: 'u-1' } } },
      data: { visible: false },
    });
  });

  it('aceptar fotos_resultado, revocar otra finalidad o revocar como visitante no tocan la galería', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'aceptado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'fotos_resultado', accion: 'revocado' }], formulario: 'banner', visitanteId: 'visitante-123456' }, { usuarioId: null }, CONTEXTO);
    expect(prisma.galeriaFoto.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * La transacción entrega un cliente tx distinto del prisma raíz, cuyas escrituras lanzan "fuera de la
 * transacción": si el servicio escribe con this.prisma en lugar de tx (o sin transacción), la prueba falla.
 */
function separado(escrituras: Record<string, string[]>, lecturas: Record<string, Record<string, unknown>> = {}) {
  const fuera = (q: string) =>
    jest.fn(() => {
      throw new Error(`${q} fuera de la transacción`);
    });
  const prisma: any = { ...lecturas };
  const tx: any = {};
  for (const [modelo, ops] of Object.entries(escrituras)) {
    prisma[modelo] = { ...(prisma[modelo] ?? {}) };
    tx[modelo] = {};
    for (const op of ops) {
      prisma[modelo][op] = fuera(`${modelo}.${op}`);
      tx[modelo][op] = jest.fn(async (args: any) => ({ id: BigInt(1), ...(args?.data ?? {}) }));
    }
  }
  prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
  return { prisma, tx };
}

describe('ConsentimientosService.registrar: filas y efecto en la cuenta por tx', () => {
  it('promociones aceptadas: consentimiento.create y usuario.update dentro de la transacción', async () => {
    const vigente = { slug: 'aviso-privacidad', version: '2.0', hashTexto: HASH_AVISO, vigenteDesde: dia('2026-10-14') };
    const { prisma, tx } = separado(
      { consentimiento: ['create'], usuario: ['update'] },
      { versionDocumentoLegal: { findFirst: jest.fn().mockResolvedValue(vigente) } },
    );
    await new ConsentimientosService(prisma).registrar(
      { formulario: 'perfil', items: [{ tipo: 'promociones', accion: 'aceptado' }] } as any,
      { usuarioId: 'u-1' },
      CONTEXTO,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.consentimiento.create).toHaveBeenCalledTimes(1);
    expect(tx.consentimiento.create.mock.calls[0][0].data).toMatchObject({ usuarioId: 'u-1', tipo: 'promociones', accion: 'aceptado', documentoSlug: 'aviso-privacidad' });
    expect(tx.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: true } });
  });
});

describe('ConsentimientosService: solo crear y leer', () => {
  it('el servicio no expone métodos de actualizar ni borrar', () => {
    const metodos = Object.getOwnPropertyNames(ConsentimientosService.prototype).filter((n) => n !== 'constructor');
    expect(metodos.length).toBeGreaterThan(0);
    for (const m of metodos) expect(m).not.toMatch(/update|delete|upsert|actualizar|editar|borrar|eliminar|modificar|quitar/i);
  });

  it('el controlador no tiene rutas PUT, PATCH ni DELETE', () => {
    const metodosHttp = Object.getOwnPropertyNames(ConsentimientosController.prototype)
      .map((n) => Reflect.getMetadata(METHOD_METADATA, ConsentimientosController.prototype[n]))
      .filter((m) => m !== undefined);
    expect(metodosHttp.length).toBeGreaterThan(0);
    for (const m of metodosHttp) expect([RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]).not.toContain(m);
  });
});

describe('ConsentimientosService.pendientes', () => {
  const AHORA = new Date('2026-10-14T18:00:00.000Z');

  it('usuaria existente sin registros: terminos y aviso de privacidad pendientes, sin inventar consentimientos', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.pendientes('u-vieja', AHORA);
    expect(r.data).toEqual([
      { tipo: 'terminos', documentoSlug: 'terminos', version: '2.0', hash: HASH_TERMINOS, vigenteDesde: '2026-10-14', versionAceptada: null },
      { tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO, vigenteDesde: '2026-10-14', versionAceptada: null },
    ]);
    expect(prisma.consentimiento.create).not.toHaveBeenCalled();
  });

  it('con la versión vigente aceptada no queda nada pendiente', async () => {
    const { servicio } = montar();
    await servicio.registrar(
      {
        items: [aceptarTerminos, { tipo: 'aviso_privacidad', documentoSlug: 'aviso-privacidad', version: '2.0', hash: HASH_AVISO, accion: 'aceptado' }],
        formulario: 'reaceptacion',
      },
      { usuarioId: 'u-1' },
      CONTEXTO,
    );
    expect((await servicio.pendientes('u-1', AHORA)).data).toEqual([]);
  });

  it('aceptó una versión anterior: el documento vuelve a quedar pendiente con la versión que aceptó', async () => {
    const { servicio } = montar();
    await servicio.registrar(
      { items: [{ ...aceptarTerminos, version: '1.0', hash: 'c'.repeat(64) }], formulario: 'registro' },
      { usuarioId: 'u-1' },
      CONTEXTO,
    );
    const terminos = (await servicio.pendientes('u-1', AHORA)).data.find((p: any) => p.tipo === 'terminos');
    expect(terminos).toMatchObject({ version: '2.0', versionAceptada: '1.0' });
  });

  it('lo que registró el personal en el alta no cuenta como aceptación de la persona: se le sigue pidiendo', async () => {
    const { servicio, prisma } = montar();
    for (const [tipo, version, hash] of [['terminos', '2.0', HASH_TERMINOS], ['aviso_privacidad', '2.0', HASH_AVISO]]) {
      prisma.filas.push({ id: BigInt(90), usuarioId: 'u-alta', tipo, accion: 'aceptado', documentoVersion: version, documentoHash: hash, registradoPorId: 'admin-1', creadoEn: new Date() });
    }
    expect((await servicio.pendientes('u-alta', AHORA)).data.map((p: any) => p.tipo)).toEqual(['terminos', 'aviso_privacidad']);
    // Cuando la persona acepta ella misma, ya no queda pendiente.
    await servicio.registrar({ items: [aceptarTerminos], formulario: 'reaceptacion' }, { usuarioId: 'u-alta' }, CONTEXTO);
    expect((await servicio.pendientes('u-alta', AHORA)).data.map((p: any) => p.tipo)).toEqual(['aviso_privacidad']);
  });

  it('si lo último que hizo fue revocar, queda pendiente', async () => {
    const { servicio } = montar();
    await servicio.registrar({ items: [aceptarTerminos], formulario: 'registro' }, { usuarioId: 'u-1' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'terminos', accion: 'revocado' }], formulario: 'perfil' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect((await servicio.pendientes('u-1', AHORA)).data.map((p: any) => p.tipo)).toContain('terminos');
  });

  it('una versión que aún no entra en vigor (vigente_desde futuro) no se pide', async () => {
    const { servicio } = montar({
      versionesExtra: [{ id: 9, slug: 'terminos', version: '3.0', hashTexto: HASH_TERMINOS_3, vigenteDesde: dia('2026-11-01') }],
    });
    await servicio.registrar({ items: [aceptarTerminos], formulario: 'registro' }, { usuarioId: 'u-1' }, CONTEXTO);
    expect((await servicio.pendientes('u-1', AHORA)).data.map((p: any) => p.tipo)).not.toContain('terminos');
    // Ya en vigor (2 de noviembre en México), la 3.0 sí se pide
    const despues = (await servicio.pendientes('u-1', new Date('2026-11-02T18:00:00.000Z'))).data.find((p: any) => p.tipo === 'terminos');
    expect(despues).toMatchObject({ version: '3.0', versionAceptada: '2.0' });
  });
});

describe('ConsentimientosService: historial propio y bandeja del admin', () => {
  it('mios trae solo las filas de la usuaria, la más reciente primero, con id en texto', async () => {
    const { servicio, prisma } = montar();
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'aceptado' }], formulario: 'a' }, { usuarioId: 'u-1' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'aceptado' }], formulario: 'b' }, { usuarioId: 'u-2' }, CONTEXTO);
    await servicio.registrar({ items: [{ tipo: 'promociones', accion: 'revocado' }], formulario: 'c' }, { usuarioId: 'u-1' }, CONTEXTO);
    const r = await servicio.mios('u-1');
    expect(prisma.consentimiento.findMany.mock.calls.at(-1)[0].where).toEqual({ usuarioId: 'u-1' });
    expect(r.data.map((f: any) => f.formulario)).toEqual(['c', 'a']);
    expect(typeof r.data[0].id).toBe('string');
  });

  it('admin: busca por nombre, correo o id, pagina y trae los datos de la persona', async () => {
    const prisma: any = {
      consentimiento: {
        findMany: jest.fn().mockResolvedValue([{ id: BigInt(7), tipo: 'terminos', usuario: { id: 'u-1', nombre: 'Ana', email: 'ana@example.com', rol: 'cliente' } }]),
        count: jest.fn().mockResolvedValue(41),
      },
    };
    const servicio = new ConsentimientosService(prisma);
    const r = await servicio.listarAdmin({ q: ' ana ', page: '2', limit: '20' });
    const args = prisma.consentimiento.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      OR: [
        { usuarioId: 'ana' },
        { visitanteId: 'ana' },
        { usuario: { is: { nombre: { contains: 'ana', mode: 'insensitive' } } } },
        { usuario: { is: { email: { contains: 'ana', mode: 'insensitive' } } } },
      ],
    });
    expect(args).toMatchObject({ skip: 20, take: 20, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }] });
    expect(args.include.usuario.select).toEqual({ id: true, nombre: true, email: true, rol: true });
    expect(r).toMatchObject({ success: true, total: 41, page: 2, limit: 20, totalPages: 3 });
    expect(r.data[0]).toMatchObject({ id: '7', usuario: { nombre: 'Ana' } });
  });

  it('admin: sin q lista todo; page y limit fuera de rango se acotan', async () => {
    const prisma: any = { consentimiento: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
    const r = await new ConsentimientosService(prisma).listarAdmin({ page: '-3', limit: '5000' });
    expect(prisma.consentimiento.findMany.mock.calls[0][0]).toMatchObject({ where: {}, skip: 0, take: 100 });
    expect(r).toMatchObject({ page: 1, limit: 100, totalPages: 1 });
  });

  it('export CSV: todas las columnas, fórmulas neutralizadas y comas escapadas', async () => {
    const fila = {
      id: BigInt(12),
      usuarioId: 'u-1',
      visitanteId: null,
      tipo: 'terminos',
      documentoSlug: 'terminos',
      documentoVersion: '2.0',
      documentoHash: HASH_TERMINOS,
      accion: 'aceptado',
      creadoEn: new Date('2026-10-14T16:00:00.000Z'),
      ip: '201.140.10.5',
      userAgent: '=HYPERLINK("http://malo")',
      formulario: '@registro',
      rutaOrigen: '/registro,paso-2',
      metodo: 'casilla_marcada',
      registradoPorId: 'admin-1',
    };
    const prisma: any = { consentimiento: { findMany: jest.fn().mockResolvedValue([fila]) } };
    const { contenido, nombreArchivo } = await new ConsentimientosService(prisma).exportarCsv({ usuarioId: 'u-1' });
    expect(prisma.consentimiento.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    const [encabezado, linea] = contenido.trim().split('\n');
    expect(encabezado).toBe(
      'id,usuario_id,visitante_id,tipo,documento_slug,documento_version,documento_hash,accion,creado_en,ip,user_agent,formulario,ruta_origen,metodo,registrado_por_id',
    );
    expect(linea).toBe(
      `12,u-1,,terminos,terminos,2.0,${HASH_TERMINOS},aceptado,2026-10-14T16:00:00.000Z,201.140.10.5,"'=HYPERLINK(""http://malo"")",'@registro,"/registro,paso-2",casilla_marcada,admin-1`,
    );
    expect(nombreArchivo).toMatch(/^consentimientos-u-1-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('ipDeRequest: la misma IP que usa el límite de peticiones (RateLimitGuard)', () => {
  it('req.ip primero (respeta trust proxy de Express); x-forwarded-for, que la clienta puede escribir, no gana', () => {
    expect(ipDeRequest({ headers: { 'x-forwarded-for': '201.1.1.1, 10.0.0.2' }, ip: '10.0.0.9' })).toBe('10.0.0.9');
    expect(ipDeRequest({ headers: {}, ip: '10.0.0.9' })).toBe('10.0.0.9');
  });

  it('sin req.ip, la dirección del socket; sin ella, el primer valor de x-forwarded-for; sin nada, null', () => {
    expect(ipDeRequest({ headers: { 'x-forwarded-for': '201.1.1.1' }, connection: { remoteAddress: '10.0.0.7' } } as any)).toBe('10.0.0.7');
    expect(ipDeRequest({ headers: { 'x-forwarded-for': '201.1.1.1, 10.0.0.2' } })).toBe('201.1.1.1');
    expect(ipDeRequest({ headers: {} })).toBeNull();
    expect(ipDeRequest(undefined)).toBeNull();
  });

  it('coincide con la clave de RateLimitGuard para las mismas peticiones', () => {
    const guard: any = new RateLimitGuard(5, 60000);
    const peticiones: any[] = [
      { headers: { 'x-forwarded-for': '201.1.1.1, 10.0.0.2' }, ip: '10.0.0.9', path: '/api/consentimientos' },
      { headers: {}, ip: '::ffff:127.0.0.1', path: '/api/consentimientos' },
      { headers: { 'x-forwarded-for': '201.1.1.1' }, connection: { remoteAddress: '10.0.0.7' }, path: '/api/consentimientos' },
      { headers: { 'x-forwarded-for': '201.1.1.1, 10.0.0.2' }, path: '/api/consentimientos' },
    ];
    for (const req of peticiones) expect(guard.getKey(req)).toBe(`${ipDeRequest(req)}:/api/consentimientos`);
  });
});

describe('Rutas /api/consentimientos', () => {
  let app: INestApplication;
  let base: string;
  const servicio = {
    registrar: jest.fn(),
    mios: jest.fn(),
    pendientes: jest.fn(),
    listarAdmin: jest.fn(),
    exportarCsv: jest.fn(),
  };
  /** Sesión de prueba por header; el admin se decide con PermisosGuard simulado por header. */
  const sesion = (opcional: boolean): CanActivate => ({
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const id = req.headers['x-usuaria'];
      if (!id) return opcional;
      req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
      return true;
    },
  });
  const soloAdmin: CanActivate = { canActivate: (ctx) => ctx.switchToHttp().getRequest().user?.rol === 'admin' };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ConsentimientosController],
      providers: [
        { provide: ConsentimientosService, useValue: servicio },
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesion(false))
      .overrideGuard(SesionOpcionalGuard)
      .useValue(sesion(true))
      .overrideGuard(PermisosGuard)
      .useValue(soloAdmin)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    servicio.registrar.mockReset().mockResolvedValue({ success: true, data: [] });
    servicio.mios.mockReset().mockResolvedValue({ success: true, data: [] });
    servicio.pendientes.mockReset().mockResolvedValue({ success: true, data: [] });
    servicio.listarAdmin.mockReset().mockResolvedValue({ success: true, data: [] });
    servicio.exportarCsv.mockReset().mockResolvedValue({ contenido: 'id\n1\n', nombreArchivo: 'consentimientos-todos-2026-10-14.csv' });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (cuerpo: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/consentimientos`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(cuerpo) });

  it('POST con sesión: 201, liga la cuenta y el backend llena ip (req.ip, como el límite de peticiones) y user agent', async () => {
    const r = await post(
      { items: [aceptarTerminos], formulario: 'perfil_privacidad', rutaOrigen: '/perfil' },
      { 'x-usuaria': 'u-1', 'x-forwarded-for': '201.1.1.1, 10.0.0.1', 'user-agent': 'Navegador de prueba' },
    );
    expect(r.status).toBe(201);
    // Sin trust proxy, x-forwarded-for (que escribe quien pide) no cuenta: la ip es la de la conexión
    expect(servicio.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ formulario: 'perfil_privacidad', rutaOrigen: '/perfil' }),
      { usuarioId: 'u-1' },
      { ip: '127.0.0.1', userAgent: 'Navegador de prueba' },
    );
  });

  it('POST sin sesión pasa usuarioId null (el servicio exige visitanteId)', async () => {
    await post({ items: [aceptarTerminos], formulario: 'banner_cookies', visitanteId: 'visitante-123456' });
    expect(servicio.registrar).toHaveBeenCalledWith(expect.objectContaining({ visitanteId: 'visitante-123456' }), { usuarioId: null }, expect.anything());
  });

  it.each([
    ['tipo desconocido', { items: [{ ...aceptarTerminos, tipo: 'otro' }], formulario: 'x' }],
    ['acción desconocida', { items: [{ ...aceptarTerminos, accion: 'quizas' }], formulario: 'x' }],
    ['hash que no es SHA-256', { items: [{ ...aceptarTerminos, hash: 'abc' }], formulario: 'x' }],
    ['sin items', { items: [], formulario: 'x' }],
    ['sin formulario', { items: [aceptarTerminos] }],
    ['campo que pone la base o el backend (ip)', { items: [aceptarTerminos], formulario: 'x', ip: '1.1.1.1' }],
    ['metodo en el elemento', { items: [{ ...aceptarTerminos, metodo: 'otro' }], formulario: 'x' }],
  ])('POST con %s: 400 sin llegar al servicio', async (_caso, cuerpo) => {
    const r = await post(cuerpo, { 'x-usuaria': 'u-1' });
    expect(r.status).toBe(400);
    expect(servicio.registrar).not.toHaveBeenCalled();
  });

  it('GET /mios y /pendientes usan la usuaria de la sesión', async () => {
    await fetch(`${base}/api/consentimientos/mios`, { headers: { 'x-usuaria': 'u-9' } });
    expect(servicio.mios).toHaveBeenCalledWith('u-9');
    await fetch(`${base}/api/consentimientos/pendientes`, { headers: { 'x-usuaria': 'u-9' } });
    expect(servicio.pendientes).toHaveBeenCalledWith('u-9');
    expect((await fetch(`${base}/api/consentimientos/mios`)).status).toBe(403);
  });

  it('GET /admin y /admin/export: la clienta no entra; el admin sí, y el export es CSV descargable', async () => {
    expect((await fetch(`${base}/api/consentimientos/admin?q=ana`, { headers: { 'x-usuaria': 'u-1' } })).status).toBe(403);
    expect((await fetch(`${base}/api/consentimientos/admin/export?formato=csv`, { headers: { 'x-usuaria': 'u-1' } })).status).toBe(403);
    expect(servicio.listarAdmin).not.toHaveBeenCalled();

    const lista = await fetch(`${base}/api/consentimientos/admin?q=ana&page=2&limit=10`, { headers: { 'x-usuaria': 'adm', 'x-rol': 'admin' } });
    expect(lista.status).toBe(200);
    expect(servicio.listarAdmin).toHaveBeenCalledWith({ q: 'ana', page: '2', limit: '10' });

    const csv = await fetch(`${base}/api/consentimientos/admin/export?usuarioId=u-1&formato=csv`, { headers: { 'x-usuaria': 'adm', 'x-rol': 'admin' } });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toBe('attachment; filename="consentimientos-todos-2026-10-14.csv"');
    expect(servicio.exportarCsv).toHaveBeenCalledWith({ usuarioId: 'u-1' });
  });

  it('export con un formato distinto de csv: 400', async () => {
    const r = await fetch(`${base}/api/consentimientos/admin/export?formato=xlsx`, { headers: { 'x-usuaria': 'adm', 'x-rol': 'admin' } });
    expect(r.status).toBe(400);
    expect(servicio.exportarCsv).not.toHaveBeenCalled();
  });

  it('las rutas de admin llevan PermisosGuard con la clave "*"', () => {
    for (const nombre of ['listarAdmin', 'exportarCsv']) {
      const handler = ConsentimientosController.prototype[nombre];
      expect(Reflect.getMetadata('permisos', handler)).toEqual(['*']);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toMatch(/^admin/);
    }
  });
});
