import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { crearErrorDeValidacion } from '../common/filters/errores-validacion';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ContenidoAdminController, ContenidoPublicoController } from './contenido.controller';
import { ContenidoService } from './contenido.service';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';
import { MENSAJE_URL_A_MANO, esPublicIdDe } from '../subidas/imagenes-subidas';

/**
 * Contenido público administrable (Admin > Contenido): promociones, preguntas frecuentes y equipo. Lo público se
 * lee sin sesión; editar exige configuracion:editar (solo admin). Prisma en memoria.
 */

const NUBE = 'nube-de-prueba';
const imagen = (ruta: string) => `https://res.cloudinary.com/${NUBE}/image/upload/v1/${ruta}`;
/** Subida propia ya comprobada (la regla completa se prueba en src/subidas): public_id del uso -> su URL. */
const subidaPropia = (uso: string, n: number) => `${uso}/panel_${String(n).padStart(32, '0')}`;
const subidasFalsas = {
  resolverImagen: jest.fn(async (_u: string, uso: any, valor: string | null | undefined, actual: string | null) => {
    if (valor === undefined) return undefined;
    if (!valor) return null;
    if (valor === actual) return actual;
    if (esPublicIdDe(uso, valor)) return imagen(`${valor}.jpg`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BadRequestException } = require('@nestjs/common');
    throw new BadRequestException(MENSAJE_URL_A_MANO);
  }),
};

const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'galeria:gestionar'],
  cliente: ['tienda:propia'],
};
const ROL_DE: Record<string, string> = { 'admin-yo': 'admin', 'estilista-yo': 'estilista', 'clienta-1': 'cliente' };

function prismaFalso() {
  const db = {
    promociones: [] as any[],
    preguntas: [] as any[],
    usuarios: [
      { id: 'u-eva', nombre: 'Eva Martínez', email: 'eva@correo.test', telefono: '7710000001', activo: true },
      { id: 'u-luz', nombre: 'Luz Pérez', email: 'luz@correo.test', telefono: '7710000002', activo: true },
      { id: 'u-baja', nombre: 'Usuaria Inactiva', email: 'baja@correo.test', telefono: '7710000003', activo: false },
    ],
    perfiles: [
      { id: 1, usuarioId: 'u-eva', puesto: 'Estilista', telefono: '7719999999', activo: true, mostrarEnSitio: true, fotoPublica: imagen('equipo/eva.jpg'), bioPublica: 'Colorista.', ordenPublico: 2, comisionPorcentaje: 10 },
      { id: 2, usuarioId: 'u-luz', puesto: 'Recepción', telefono: null, activo: true, mostrarEnSitio: false, fotoPublica: null, bioPublica: null, ordenPublico: 0, comisionPorcentaje: null },
      { id: 3, usuarioId: 'u-baja', puesto: 'Estilista', telefono: null, activo: true, mostrarEnSitio: true, fotoPublica: null, bioPublica: null, ordenPublico: 1, comisionPorcentaje: null },
      { id: 4, usuarioId: 'u-luz', puesto: 'Antiguo', telefono: null, activo: false, mostrarEnSitio: true, fotoPublica: null, bioPublica: null, ordenPublico: 0, comisionPorcentaje: null },
    ] as any[],
  };
  const ids = { promocion: 1, pregunta: 1 };

  const relacion = (fila: any, nombre: string) => (nombre === 'usuario' ? db.usuarios.find((u) => u.id === fila.usuarioId) ?? null : null);
  const coincide = (fila: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'OR') return (v as any[]).some((w) => coincide(fila, w));
      if (k === 'AND') return (v as any[]).every((w) => coincide(fila, w));
      if (v === null) return fila[k] == null;
      if (v instanceof Date) return fila[k] instanceof Date && fila[k].getTime() === v.getTime();
      if (v && typeof v === 'object') {
        if ('is' in v) {
          const r = relacion(fila, k);
          return r ? coincide(r, v.is) : false;
        }
        if ('in' in v) return (v.in as any[]).includes(fila[k]);
        if ('lte' in v) return fila[k] != null && fila[k] <= v.lte;
        if ('gte' in v) return fila[k] != null && fila[k] >= v.gte;
        throw new Error(`Filtro no soportado en la prueba: ${k}`);
      }
      return fila[k] === v;
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
  const tabla = (lista: any[], clave: 'promocion' | 'pregunta', porOmision: Record<string, unknown>) => ({
    findMany: jest.fn(async ({ where, orderBy }: any = {}) => ordenar(lista.filter((f) => coincide(f, where)), orderBy).map((f) => ({ ...f }))),
    findUnique: jest.fn(async ({ where }: any) => lista.find((f) => f.id === where.id) ?? null),
    count: jest.fn(async ({ where }: any = {}) => lista.filter((f) => coincide(f, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const fila = { id: ids[clave]++, ...porOmision, ...data };
      lista.push(fila);
      return { ...fila };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const f = lista.find((x) => x.id === where.id);
      if (!f) throw Object.assign(new Error('No existe'), { code: 'P2025' });
      Object.assign(f, data);
      return { ...f };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = lista.findIndex((x) => x.id === where.id);
      if (i < 0) throw Object.assign(new Error('No existe'), { code: 'P2025' });
      return lista.splice(i, 1)[0];
    }),
  });

  const prisma: any = {
    db,
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    promocion: tabla(db.promociones, 'promocion', { imagenUrl: null, enlace: null, vigenteDesde: null, vigenteHasta: null, activa: false, destacada: false, orden: 0 }),
    preguntaFrecuente: tabla(db.preguntas, 'pregunta', { orden: 0, visible: true }),
    perfilEmpleado: {
      findMany: jest.fn(async ({ where, orderBy }: any = {}) =>
        ordenar(db.perfiles.filter((p) => coincide(p, where)), orderBy).map((p) => ({ ...p, usuario: relacion(p, 'usuario') })),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const p = db.perfiles.find((x) => x.id === where.id);
        return p ? { ...p, usuario: relacion(p, 'usuario') } : null;
      }),
      count: jest.fn(async ({ where }: any = {}) => db.perfiles.filter((p) => coincide(p, where)).length),
      update: jest.fn(async ({ where, data }: any) => {
        const p = db.perfiles.find((x) => x.id === where.id);
        Object.assign(p, data);
        return { ...p, usuario: relacion(p, 'usuario') };
      }),
    },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
}

const guardFalso: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) throw new UnauthorizedException();
    req.user = { id, rol: ROL_DE[id] };
    return true;
  },
};

describe('Contenido', () => {
  let app: INestApplication;
  let base: string;
  let prisma: any;
  let servicio: ContenidoService;
  const originalNube = process.env.CLOUDINARY_CLOUD_NAME;

  beforeAll(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = NUBE;
    prisma = prismaFalso();
    const modulo = await Test.createTestingModule({
      controllers: [ContenidoPublicoController, ContenidoAdminController],
      providers: [ContenidoService, { provide: PrismaService, useValue: prisma }, { provide: ImagenesSubidasService, useValue: subidasFalsas }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardFalso)
      .compile();
    servicio = modulo.get(ContenidoService);
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: crearErrorDeValidacion,
      }),
    );
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    prisma.db.promociones.length = 0;
    prisma.db.preguntas.length = 0;
  });

  afterAll(async () => {
    await app.close();
    if (originalNube === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = originalNube;
  });

  const pedir = (metodo: string, ruta: string, quien: string | null, cuerpo?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (quien) headers['x-usuaria'] = quien;
    return fetch(`${base}/api/contenido${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  };

  describe('permisos', () => {
    it('lo público se lee sin sesión y con caché corta', async () => {
      for (const ruta of ['/promociones', '/preguntas-frecuentes', '/equipo']) {
        const res = await pedir('GET', ruta, null);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toContain('max-age=60');
      }
    });

    it('la administración exige configuracion:editar: sin sesión 401, clienta y estilista 403, admin sí', async () => {
      const rutas: Array<[string, string, unknown?]> = [
        ['GET', '/admin/promociones'],
        ['POST', '/admin/promociones', { titulo: 'Promo', descripcion: 'Texto' }],
        ['GET', '/admin/preguntas-frecuentes'],
        ['POST', '/admin/preguntas-frecuentes', { pregunta: '¿Hay estacionamiento?', respuesta: 'Sí.' }],
        ['GET', '/admin/equipo'],
        ['PATCH', '/admin/equipo/2', { mostrarEnSitio: true }],
      ];
      for (const [metodo, ruta, cuerpo] of rutas) {
        expect((await pedir(metodo, ruta, null, cuerpo)).status).toBe(401);
        expect((await pedir(metodo, ruta, 'clienta-1', cuerpo)).status).toBe(403);
        expect((await pedir(metodo, ruta, 'estilista-yo', cuerpo)).status).toBe(403);
        expect([200, 201]).toContain((await pedir(metodo, ruta, 'admin-yo', cuerpo)).status);
      }
      prisma.db.perfiles[1].mostrarEnSitio = false;
    });
  });

  describe('promociones', () => {
    it('el admin crea, edita, ordena y elimina; las fechas son días de México', async () => {
      const creada = await pedir('POST', '/admin/promociones', 'admin-yo', {
        titulo: '  Martes de color ',
        descripcion: '15% en tintes los martes.',
        imagenUrl: subidaPropia('promociones', 1),
        enlace: '/cliente/servicios-citas',
        vigenteDesde: '2026-10-15',
        vigenteHasta: '2026-10-31',
        activa: true,
        destacada: true,
      });
      expect(creada.status).toBe(201);
      const { data } = await creada.json();
      expect(data).toMatchObject({ titulo: 'Martes de color', vigenteDesde: '2026-10-15', vigenteHasta: '2026-10-31', activa: true, destacada: true });
      // 00:00 de México (UTC-6) de cada día
      expect(prisma.db.promociones[0].vigenteDesde.toISOString()).toBe('2026-10-15T06:00:00.000Z');
      expect(prisma.db.promociones[0].vigenteHasta.toISOString()).toBe('2026-10-31T06:00:00.000Z');

      const editada = await pedir('PATCH', `/admin/promociones/${data.id}`, 'admin-yo', { activa: false, vigenteHasta: null, imagenUrl: null });
      expect(editada.status).toBe(200);
      expect(prisma.db.promociones[0]).toMatchObject({ activa: false, vigenteHasta: null, imagenUrl: null });

      const otra = await (await pedir('POST', '/admin/promociones', 'admin-yo', { titulo: 'Otra', descripcion: 'Texto' })).json();
      expect((await pedir('PUT', '/admin/promociones/orden', 'admin-yo', { ids: [otra.data.id, data.id] })).status).toBe(200);
      expect(prisma.db.promociones.map((p: any) => [p.id, p.orden])).toEqual([[data.id, 1], [otra.data.id, 0]]);
      const lista = await (await pedir('GET', '/admin/promociones', 'admin-yo')).json();
      expect(lista.data.map((p: any) => p.id)).toEqual([otra.data.id, data.id]);

      expect((await pedir('DELETE', `/admin/promociones/${data.id}`, 'admin-yo')).status).toBe(200);
      expect(prisma.db.promociones).toHaveLength(1);
      expect((await pedir('DELETE', '/admin/promociones/999', 'admin-yo')).status).toBe(404);
    });

    it.each([
      ['sin título', { titulo: '   ', descripcion: 'x' }, /título/i],
      ['sin descripción', { titulo: 'Promo', descripcion: '' }, /descripción/i],
      ['imagen escrita a mano', { titulo: 'P', descripcion: 'x', imagenUrl: 'https://example.com/a.jpg' }, /Subir foto/],
      ['imagen de Cloudinary pegada a mano', { titulo: 'P', descripcion: 'x', imagenUrl: imagen('promos/martes.jpg') }, /Subir foto/],
      ['enlace externo', { titulo: 'P', descripcion: 'x', enlace: 'https://otro.sitio/x' }, /\//],
      ['enlace que salta de dominio', { titulo: 'P', descripcion: 'x', enlace: '//otro.sitio' }, /\//],
      ['desde después de hasta', { titulo: 'P', descripcion: 'x', vigenteDesde: '2026-11-02', vigenteHasta: '2026-11-01' }, /fecha/i],
      ['fecha inválida', { titulo: 'P', descripcion: 'x', vigenteDesde: '2026-02-30' }, /fecha/i],
    ])('%s: 400 en español', async (_caso, cuerpo, mensaje) => {
      const res = await pedir('POST', '/admin/promociones', 'admin-yo', cuerpo);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(mensaje);
    });

    it('editar solo una fecha también respeta desde <= hasta', async () => {
      const { data } = await (await pedir('POST', '/admin/promociones', 'admin-yo', { titulo: 'P', descripcion: 'x', vigenteDesde: '2026-10-10', vigenteHasta: '2026-10-20' })).json();
      expect((await pedir('PATCH', `/admin/promociones/${data.id}`, 'admin-yo', { vigenteDesde: '2026-10-25' })).status).toBe(400);
    });

    it('público: solo activas y vigentes hoy en hora de México, ordenadas', () => {
      const dia = (d: string) => new Date(`${d}T06:00:00.000Z`);
      prisma.db.promociones.push(
        { id: 1, titulo: 'Vigente', descripcion: 'a', activa: true, destacada: false, orden: 1, vigenteDesde: dia('2026-10-15'), vigenteHasta: dia('2026-10-20'), imagenUrl: null, enlace: null },
        { id: 2, titulo: 'Sin fechas', descripcion: 'b', activa: true, destacada: true, orden: 0, vigenteDesde: null, vigenteHasta: null, imagenUrl: null, enlace: '/cliente/tienda-online' },
        { id: 3, titulo: 'Inactiva', descripcion: 'c', activa: false, destacada: false, orden: 0, vigenteDesde: null, vigenteHasta: null, imagenUrl: null, enlace: null },
      );
      const titulos = async (ahora: string) => (await servicio.promocionesPublicas(new Date(ahora))).data.map((p: any) => p.titulo);
      // 23:30 del 14 en México: todavía no empieza
      return (async () => {
        expect(await titulos('2026-10-15T05:30:00.000Z')).toEqual(['Sin fechas']);
        expect(await titulos('2026-10-15T06:30:00.000Z')).toEqual(['Sin fechas', 'Vigente']);
        // 23:00 del 20 en México: último día, sigue vigente
        expect(await titulos('2026-10-21T05:00:00.000Z')).toEqual(['Sin fechas', 'Vigente']);
        expect(await titulos('2026-10-21T06:30:00.000Z')).toEqual(['Sin fechas']);
        const [p] = (await servicio.promocionesPublicas(new Date('2026-10-16T12:00:00.000Z'))).data;
        expect(Object.keys(p).sort()).toEqual(['descripcion', 'destacada', 'enlace', 'id', 'imagenUrl', 'titulo', 'vigenteDesde', 'vigenteHasta'].sort());
      })();
    });
  });

  describe('preguntas frecuentes', () => {
    it('CRUD del admin y lo público solo trae las visibles, ordenadas', async () => {
      const a = await (await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: '¿Aceptan tarjeta?', respuesta: 'Sí, todas.', orden: 2 })).json();
      const b = await (await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: '¿Hay estacionamiento?', respuesta: 'No.', orden: 1 })).json();
      await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: 'Oculta', respuesta: 'x', visible: false });
      const publicas = await (await pedir('GET', '/preguntas-frecuentes', null)).json();
      expect(publicas.data).toEqual([
        { id: b.data.id, pregunta: '¿Hay estacionamiento?', respuesta: 'No.' },
        { id: a.data.id, pregunta: '¿Aceptan tarjeta?', respuesta: 'Sí, todas.' },
      ]);
      expect((await pedir('PATCH', `/admin/preguntas-frecuentes/${a.data.id}`, 'admin-yo', { visible: false })).status).toBe(200);
      expect((await (await pedir('GET', '/preguntas-frecuentes', null)).json()).data).toHaveLength(1);
      expect((await pedir('PUT', '/admin/preguntas-frecuentes/orden', 'admin-yo', { ids: [a.data.id, b.data.id] })).status).toBe(200);
      expect((await pedir('DELETE', `/admin/preguntas-frecuentes/${b.data.id}`, 'admin-yo')).status).toBe(200);
      expect((await (await pedir('GET', '/admin/preguntas-frecuentes', 'admin-yo')).json()).data).toHaveLength(2);
    });

    it('pregunta y respuesta obligatorias: 400', async () => {
      expect((await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: ' ', respuesta: 'x' })).status).toBe(400);
      expect((await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: 'x', respuesta: '' })).status).toBe(400);
      expect((await pedir('POST', '/admin/preguntas-frecuentes', 'admin-yo', { pregunta: 'x', respuesta: 'y', visible: 'si' })).status).toBe(400);
    });
  });

  describe('equipo', () => {
    it('público: solo perfiles marcados, activos y con usuario activo; sin correo, teléfono ni otro dato', async () => {
      const res = await pedir('GET', '/equipo', null);
      const texto = await res.text();
      expect(JSON.parse(texto).data).toEqual([{ nombre: 'Eva Martínez', puesto: 'Estilista', foto: imagen('equipo/eva.jpg'), bio: 'Colorista.' }]);
      for (const prohibido of ['correo.test', '771', 'usuarioId', 'comision', 'u-eva']) expect(texto).not.toContain(prohibido);
    });

    it('admin: lista de perfiles activos con nombre y puesto, y edita lo que se publica', async () => {
      const lista = await (await pedir('GET', '/admin/equipo', 'admin-yo')).json();
      expect(lista.data.map((p: any) => p.id)).toEqual(expect.arrayContaining([1, 2, 3]));
      expect(lista.data.find((p: any) => p.id === 4)).toBeUndefined();
      expect(lista.data.find((p: any) => p.id === 1)).toMatchObject({ nombre: 'Eva Martínez', puesto: 'Estilista', mostrarEnSitio: true });
      expect(JSON.stringify(lista)).not.toContain('correo.test');

      const res = await pedir('PATCH', '/admin/equipo/2', 'admin-yo', { mostrarEnSitio: true, fotoPublica: subidaPropia('equipo', 2), bioPublica: '  Te recibe con café. ', ordenPublico: 1 });
      expect(res.status).toBe(200);
      expect(prisma.db.perfiles[1]).toMatchObject({ mostrarEnSitio: true, fotoPublica: imagen(`${subidaPropia('equipo', 2)}.jpg`), bioPublica: 'Te recibe con café.', ordenPublico: 1 });
      expect((await pedir('PATCH', '/admin/equipo/2', 'admin-yo', { bioPublica: '' })).status).toBe(200);
      expect(prisma.db.perfiles[1].bioPublica).toBeNull();
      expect((await pedir('PUT', '/admin/equipo/orden', 'admin-yo', { ids: [2, 1] })).status).toBe(200);
      expect(prisma.db.perfiles[1].ordenPublico).toBe(0);
      expect(prisma.db.perfiles[0].ordenPublico).toBe(1);
      prisma.db.perfiles[1].mostrarEnSitio = false;
    });

    it('bio de más de 600, foto fuera de Cloudinary o perfil inactivo: 400 o 404', async () => {
      expect((await pedir('PATCH', '/admin/equipo/2', 'admin-yo', { bioPublica: 'a'.repeat(601) })).status).toBe(400);
      expect((await pedir('PATCH', '/admin/equipo/2', 'admin-yo', { fotoPublica: 'https://example.com/a.jpg' })).status).toBe(400);
      expect((await pedir('PATCH', '/admin/equipo/4', 'admin-yo', { mostrarEnSitio: true })).status).toBe(404);
      expect((await pedir('PATCH', '/admin/equipo/99', 'admin-yo', { mostrarEnSitio: true })).status).toBe(404);
    });
  });
});
