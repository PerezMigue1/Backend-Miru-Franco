import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { crearErrorDeValidacion } from '../common/filters/errores-validacion';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { firmarParametrosCloudinary } from '../auth/firma-cloudinary';
import { GaleriaController } from './galeria.controller';
import { GaleriaService } from './galeria.service';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';
import {
  CloudinaryGaleria,
  borrarImagenCloudinary,
  consultarRecursoCloudinary,
  crearFirmaFotoGaleria,
  urlPublicaGaleria,
  validarUrlGaleria,
} from './cloudinary-galeria';
import { nuevoPublicId } from '../subidas/imagenes-subidas';

/**
 * Galería del salón (Operaciones > Galería y GET /api/galeria). Prisma en memoria; Cloudinary simulado.
 * Regla de publicación: una foto visible necesita la declaración de que no aparece nadie identificable o la
 * autorización vigente (último movimiento de fotos_resultado aceptado) de la clienta que aparece.
 */

const NUBE = 'nube-de-prueba';
const url = (ruta: string) => `https://res.cloudinary.com/${NUBE}/image/upload/v1700000000/${ruta}`;

const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: ['citas:escritura', 'galeria:gestionar'],
  empleado: ['ventas:escritura', 'galeria:gestionar'],
  becario: ['citas:asignadas', 'galeria:lectura'],
  cliente: ['tienda:propia'],
};
const ROL_DE: Record<string, string> = {
  'admin-yo': 'admin',
  'estilista-yo': 'estilista',
  'empleado-yo': 'empleado',
  'becario-yo': 'becario',
  'clienta-1': 'cliente',
  'clienta-2': 'cliente',
  'clienta-3': 'cliente',
};

const dia = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

function prismaFalso() {
  const db = {
    servicios: [
      { id: 1, nombre: 'Corte de autor', categoria: 'Cabello', activo: true },
      { id: 2, nombre: 'Tinte retirado', categoria: 'Color', activo: false },
    ],
    usuarios: [
      { id: 'clienta-1', nombre: 'Ana López', email: 'ana@correo.test', telefono: '7710000001', activo: true },
      { id: 'clienta-2', nombre: 'Beatriz Ruiz', email: 'bea@correo.test', telefono: '7710000002', activo: true },
      { id: 'clienta-3', nombre: 'Ana María Gil', email: 'anam@correo.test', telefono: '7710000003', activo: true },
      // Cuenta cancelada (anonimizada) o desactivada: su autorización no se ofrece
      { id: 'clienta-4', nombre: 'Ana Desactivada', email: 'anad@correo.test', telefono: '7710000004', activo: false },
      { id: 'estilista-yo', nombre: 'Eva Estilista', email: 'eva@correo.test', telefono: '7710000009', activo: true },
    ],
    consentimientos: [
      // Ana: aceptó (id 1). Beatriz: aceptó (2) y después revocó (3). Ana María: aceptó (4). 5 es de otro tipo.
      { id: BigInt(1), usuarioId: 'clienta-1', tipo: 'fotos_resultado', accion: 'aceptado', creadoEn: dia(1) },
      { id: BigInt(2), usuarioId: 'clienta-2', tipo: 'fotos_resultado', accion: 'aceptado', creadoEn: dia(2) },
      { id: BigInt(3), usuarioId: 'clienta-2', tipo: 'fotos_resultado', accion: 'revocado', creadoEn: dia(3) },
      { id: BigInt(4), usuarioId: 'clienta-3', tipo: 'fotos_resultado', accion: 'aceptado', creadoEn: dia(4) },
      { id: BigInt(5), usuarioId: 'clienta-1', tipo: 'promociones', accion: 'aceptado', creadoEn: dia(5) },
      { id: BigInt(6), usuarioId: null, visitanteId: 'v-1', tipo: 'fotos_resultado', accion: 'aceptado', creadoEn: dia(6) },
      { id: BigInt(7), usuarioId: 'clienta-4', tipo: 'fotos_resultado', accion: 'aceptado', creadoEn: dia(7) },
    ] as any[],
    fotos: [] as any[],
    /** Firmas de subida de la galería emitidas por el servidor (galeria_firmas). */
    firmas: [] as any[],
    /** URLs que usan otras tablas (servicios, presentaciones, equipo, configuración, promociones, usuarios). */
    usos: [] as string[],
    /** Texto de la última consulta de uso, para comprobar que revisa todas las tablas. */
    consultaUso: '' as string,
  };
  let siguienteId = 1;

  const valor = (fila: any, campo: string) => fila[campo];
  const coincide = (fila: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'OR') return (v as any[]).some((w) => coincide(fila, w));
      if (k === 'AND') return (v as any[]).every((w) => coincide(fila, w));
      if (v === null) return valor(fila, k) == null;
      if (v && typeof v === 'object' && !(v instanceof Date) && typeof v !== 'bigint') {
        if ('in' in v) return (v.in as any[]).some((x) => x === valor(fila, k) || String(x) === String(valor(fila, k)));
        if ('not' in v) return v.not === null ? valor(fila, k) != null : valor(fila, k) !== v.not;
        if ('contains' in v) return String(valor(fila, k) ?? '').toLowerCase().includes(String(v.contains).toLowerCase());
        if ('is' in v) {
          const relacion = relacionDe(fila, k);
          return relacion ? coincide(relacion, v.is) : false;
        }
        throw new Error(`Filtro no soportado en la prueba: ${k}`);
      }
      return valor(fila, k) === v || (typeof v === 'bigint' && valor(fila, k) === v);
    });
  const relacionDe = (fila: any, nombre: string): any => {
    if (nombre === 'usuario') return db.usuarios.find((u) => u.id === fila.usuarioId) ?? null;
    if (nombre === 'consentimiento') return db.consentimientos.find((c) => c.id === fila.consentimientoId) ?? null;
    if (nombre === 'servicio') return db.servicios.find((s) => s.id === fila.servicioId) ?? null;
    return null;
  };
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
  const conRelaciones = (f: any) => {
    const consentimiento = db.consentimientos.find((c) => c.id === f.consentimientoId);
    return {
      ...f,
      servicio: db.servicios.find((s) => s.id === f.servicioId) ?? null,
      consentimiento: consentimiento
        ? { ...consentimiento, usuario: db.usuarios.find((u) => u.id === consentimiento.usuarioId) ?? null }
        : null,
      subidoPor: db.usuarios.find((u) => u.id === f.subidoPorId) ?? null,
    };
  };

  const prisma: any = {
    db,
    usuario: {
      findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)),
    },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    servicio: { findUnique: jest.fn(async ({ where }: any) => db.servicios.find((s) => s.id === where.id) ?? null) },
    consentimiento: {
      findUnique: jest.fn(async ({ where }: any) => db.consentimientos.find((c) => c.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where, orderBy }: any) => ordenar(db.consentimientos.filter((c) => coincide(c, where)), orderBy)[0] ?? null),
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        const lista = ordenar(db.consentimientos.filter((c) => coincide(c, where)), orderBy).map((c) => ({
          ...c,
          usuario: db.usuarios.find((u) => u.id === c.usuarioId) ?? null,
        }));
        return take ? lista.slice(0, take) : lista;
      }),
    },
    galeriaFoto: {
      findMany: jest.fn(async ({ where, orderBy }: any = {}) =>
        ordenar(db.fotos.filter((f) => coincide(f, where)), orderBy).map(conRelaciones),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const f = db.fotos.find((x) => x.id === where.id);
        return f ? conRelaciones(f) : null;
      }),
      count: jest.fn(async ({ where }: any = {}) => db.fotos.filter((f) => coincide(f, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const fila = {
          id: siguienteId++,
          publicId: null,
          orden: 0,
          visible: false,
          ilustrativa: false,
          sinPersonasIdentificables: null,
          servicioId: null,
          consentimientoId: null,
          subidoPorId: null,
          creadoEn: new Date(),
          ...data,
        };
        db.fotos.push(fila);
        return conRelaciones(fila);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const f = db.fotos.find((x) => x.id === where.id);
        if (!f) throw Object.assign(new Error('No existe'), { code: 'P2025' });
        Object.assign(f, data);
        return conRelaciones(f);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const lista = db.fotos.filter((f) => coincide(f, where));
        for (const f of lista) Object.assign(f, data);
        return { count: lista.length };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = db.fotos.findIndex((x) => x.id === where.id);
        if (i < 0) throw Object.assign(new Error('No existe'), { code: 'P2025' });
        return db.fotos.splice(i, 1)[0];
      }),
    },
    firmaSubida: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: db.firmas.length + 1, usadaEn: null, creadoEn: new Date(), ...data };
        db.firmas.push(fila);
        return fila;
      }),
      findUnique: jest.fn(async ({ where }: any) => db.firmas.find((x) => x.publicId === where.publicId) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const lista = db.firmas.filter((x) => x.id === where.id && x.usadaEn === null && (!where.venceEn?.gt || x.venceEn > where.venceEn.gt));
        for (const x of lista) Object.assign(x, data);
        return { count: lista.length };
      }),
    },
    $queryRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
      db.consultaUso = partes.join('?');
      const buscado = String(valores[0]);
      const excluir = valores[valores.length - 1];
      const enGaleria = db.fotos.some((x) => x.id !== excluir && String(x.url).includes(buscado));
      return [{ en_uso: enGaleria || db.usos.some((u) => u.includes(buscado)) }];
    }),
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return prisma;
}

/** Foto ya guardada (directo en la "base"), con los valores por omisión de la tabla. */
function sembrar(prisma: any, datos: Record<string, unknown>) {
  const fila = {
    id: prisma.db.fotos.length + 100,
    url: url(`galeria/foto-${prisma.db.fotos.length + 100}.jpg`),
    publicId: `galeria/foto-${prisma.db.fotos.length + 100}`,
    alt: 'Foto',
    orden: 0,
    visible: false,
    ilustrativa: false,
    sinPersonasIdentificables: null,
    servicioId: null,
    consentimientoId: null,
    subidoPorId: null,
    creadoEn: new Date(),
    ...datos,
  };
  prisma.db.fotos.push(fila);
  return fila;
}

/** El JwtAuthGuard real necesita un JWT firmado; aquí la persona llega en un header de prueba. */
const guardFalso: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-usuaria'];
    if (!id) throw new UnauthorizedException();
    req.user = { id, rol: ROL_DE[id] };
    return true;
  },
};

describe('Galería', () => {
  let app: INestApplication;
  let base: string;
  let prisma: any;
  const cloudinary = {
    borrar: jest.fn<Promise<'ok' | 'no_encontrada'>, [string]>(),
    recurso: jest.fn<Promise<{ version: number; format: string } | null>, [string]>(),
  };
  const originalLlave = process.env.CLOUDINARY_API_KEY;
  const originalSecreto = process.env.CLOUDINARY_API_SECRET;
  const originalNube = process.env.CLOUDINARY_CLOUD_NAME;

  beforeAll(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = NUBE;
    process.env.CLOUDINARY_API_KEY = 'llave-de-prueba';
    process.env.CLOUDINARY_API_SECRET = 'secreto-de-prueba';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma = prismaFalso();
    const modulo = await Test.createTestingModule({
      controllers: [GaleriaController],
      providers: [GaleriaService, ImagenesSubidasService, { provide: PrismaService, useValue: prisma }, { provide: CloudinaryGaleria, useValue: cloudinary }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardFalso)
      .compile();
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
    prisma.db.fotos.length = 0;
    prisma.db.firmas.length = 0;
    prisma.db.usos.length = 0;
    cloudinary.borrar.mockReset();
    cloudinary.recurso.mockReset();
    cloudinary.recurso.mockResolvedValue({ version: 1700000000, format: 'jpg' });
  });

  afterAll(async () => {
    await app.close();
    if (originalNube === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = originalNube;
    if (originalLlave === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = originalLlave;
    if (originalSecreto === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = originalSecreto;
    jest.restoreAllMocks();
  });

  const pedir = (metodo: string, ruta: string, quien: string | null, cuerpo?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (quien) headers['x-usuaria'] = quien;
    return fetch(`${base}/api/galeria${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  };
  let siguienteFirma = 1;
  /** Firma emitida por el servidor para `quien` (como si la hubiera pedido en POST /api/galeria/firma). */
  const firmar = (quien = 'estilista-yo', opciones: { ilustrativa?: boolean; venceEn?: Date; usadaEn?: Date | null } = {}) => {
    const publicId = `${opciones.ilustrativa ? 'galeria/ilustrativas' : 'galeria'}/panel_${String(siguienteFirma++).padStart(32, '0')}`;
    prisma.db.firmas.push({
      id: prisma.db.firmas.length + 1,
      uso: 'galeria',
      publicId,
      usuarioId: quien,
      ilustrativa: !!opciones.ilustrativa,
      venceEn: opciones.venceEn ?? new Date(Date.now() + 60 * 60 * 1000),
      usadaEn: opciones.usadaEn ?? null,
    });
    return publicId;
  };
  const nueva = (cambios: Record<string, unknown> = {}) => ({ publicId: firmar('estilista-yo'), alt: 'Corte bob con flequillo', ...cambios });

  describe('permisos por ruta', () => {
    it('GET /api/galeria es pública (sin sesión)', async () => {
      expect((await pedir('GET', '', null)).status).toBe(200);
    });

    it('GET /api/galeria/panel: sin sesión 401, clienta 403; becaria, estilista, empleada y admin lo ven', async () => {
      expect((await pedir('GET', '/panel', null)).status).toBe(401);
      expect((await pedir('GET', '/panel', 'clienta-1')).status).toBe(403);
      for (const quien of ['becario-yo', 'estilista-yo', 'empleado-yo', 'admin-yo']) {
        expect((await pedir('GET', '/panel', quien)).status).toBe(200);
      }
    });

    it('gestionar (registrar, editar, ordenar, borrar, buscar autorizaciones): estilista y empleada sí; becaria y clienta 403; sin sesión 401', async () => {
      const foto = sembrar(prisma, {});
      const rutas = (quien: string): Array<[string, string, unknown?]> => [
        ['POST', '/firma', {}],
        ['POST', '', { publicId: firmar(quien), alt: 'Corte bob con flequillo' }],
        ['PATCH', `/${foto.id}`, { alt: 'Otro texto' }],
        ['PUT', '/orden', { ids: [foto.id] }],
        ['GET', '/autorizaciones?q=ana'],
        ['DELETE', `/${foto.id}`],
      ];
      for (const [metodo, ruta, cuerpo] of rutas('estilista-yo')) {
        expect((await pedir(metodo, ruta, null, cuerpo)).status).toBe(401);
        expect((await pedir(metodo, ruta, 'clienta-1', cuerpo)).status).toBe(403);
        expect((await pedir(metodo, ruta, 'becario-yo', cuerpo)).status).toBe(403);
      }
      cloudinary.borrar.mockResolvedValue('ok');
      for (const [metodo, ruta, cuerpo] of rutas('estilista-yo')) {
        const res = await pedir(metodo, ruta, 'estilista-yo', cuerpo);
        expect([200, 201]).toContain(res.status);
      }
      sembrar(prisma, { id: foto.id });
      for (const [metodo, ruta, cuerpo] of rutas('empleado-yo')) {
        const res = await pedir(metodo, ruta, 'empleado-yo', cuerpo);
        expect([200, 201]).toContain(res.status);
      }
    });
  });

  describe('GET /api/galeria (pública)', () => {
    it('solo fotos visibles y no ilustrativas, ordenadas por orden e id, con el mínimo de datos', async () => {
      sembrar(prisma, { id: 1, orden: 2, visible: true, sinPersonasIdentificables: true, servicioId: 1, alt: 'Corte A' });
      sembrar(prisma, { id: 2, orden: 1, visible: true, consentimientoId: BigInt(1), sinPersonasIdentificables: false, alt: 'Peinado B' });
      sembrar(prisma, { id: 3, orden: 0, visible: false, sinPersonasIdentificables: true, alt: 'Oculta' });
      sembrar(prisma, { id: 4, orden: 0, visible: false, ilustrativa: true, alt: 'Ilustrativa' });
      // Anterior sin revisar que ya estaba publicada: se conserva como hoy.
      sembrar(prisma, { id: 5, orden: 2, visible: true, sinPersonasIdentificables: null, alt: 'Anterior' });
      const res = await pedir('GET', '', null);
      const texto = await res.text();
      const { data } = JSON.parse(texto);
      expect(data.map((f: any) => f.id)).toEqual([2, 1, 5]);
      expect(data[1]).toEqual({ id: 1, url: url('galeria/foto-100.jpg'), alt: 'Corte A', servicio: { id: 1, nombre: 'Corte de autor', categoria: 'Cabello' } });
      expect(data[0].servicio).toBeNull();
      for (const prohibido of ['consentimiento', 'sinPersonas', 'subidoPor', 'Ana', 'correo', 'publicId']) expect(texto).not.toContain(prohibido);
      expect(res.headers.get('cache-control')).toContain('max-age=60');
    });

    it('una foto con la autorización ya revocada no se publica aunque siga marcada como visible', async () => {
      sembrar(prisma, { id: 7, visible: true, consentimientoId: BigInt(2), sinPersonasIdentificables: false });
      const { data } = await (await pedir('GET', '', null)).json();
      expect(data).toEqual([]);
    });

    it('el servicio inactivo no se enlaza', async () => {
      sembrar(prisma, { id: 8, visible: true, sinPersonasIdentificables: true, servicioId: 2 });
      const { data } = await (await pedir('GET', '', null)).json();
      expect(data[0].servicio).toBeNull();
    });
  });

  describe('POST /api/galeria/firma (solo subidas desde el panel)', () => {
    it('el servidor genera el public_id dentro de galeria/ con un prefijo único y guarda la firma vigente una hora', async () => {
      const res = await pedir('POST', '/firma', 'estilista-yo', {});
      expect([200, 201]).toContain(res.status);
      const { data } = await res.json();
      expect(data.params.public_id).toMatch(/^galeria\/panel_[0-9a-f]{32}$/);
      expect(data.params).not.toHaveProperty('folder');
      expect(data.params.overwrite).toBe('false');
      expect(data.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${NUBE}/image/upload`);
      expect(data.signature).toMatch(/^[0-9a-f]{40}$/);
      expect(JSON.stringify(data)).not.toContain('secreto-de-prueba');
      const guardada = prisma.db.firmas.find((x: any) => x.publicId === data.params.public_id);
      expect(guardada).toMatchObject({ usuarioId: 'estilista-yo', ilustrativa: false, usadaEn: null });
      const minutos = (guardada.venceEn.getTime() - Date.now()) / 60000;
      expect(minutos).toBeGreaterThan(55);
      expect(minutos).toBeLessThanOrEqual(60);
    });

    it('cada firma tiene su propio public_id; la ilustrativa va a galeria/ilustrativas', async () => {
      const a = (await (await pedir('POST', '/firma', 'estilista-yo', {})).json()).data.params.public_id;
      const b = (await (await pedir('POST', '/firma', 'estilista-yo', {})).json()).data.params.public_id;
      expect(a).not.toBe(b);
      const ilus = (await (await pedir('POST', '/firma', 'empleado-yo', { ilustrativa: true })).json()).data.params.public_id;
      expect(ilus).toMatch(/^galeria\/ilustrativas\/panel_[0-9a-f]{32}$/);
    });

    it('no acepta que el cliente elija carpeta, public_id ni URL', async () => {
      for (const extra of [{ public_id: 'servicios/x' }, { folder: 'servicios' }, { url: url('galeria/a.jpg') }]) {
        expect((await pedir('POST', '/firma', 'estilista-yo', extra)).status).toBe(400);
      }
    });
  });

  describe('POST /api/galeria', () => {
    it('registra la foto declarada sin personas identificables; la URL la arma el servidor desde el public_id', async () => {
      const publicId = firmar('estilista-yo');
      const res = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Corte bob', visible: true, sinPersonasIdentificables: true, servicioId: 1, orden: 3 });
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data).toMatchObject({ visible: true, sinPersonasIdentificables: true, servicio: { id: 1 }, orden: 3, ilustrativa: false, url: url(`${publicId}.jpg`) });
      expect(prisma.db.fotos[0]).toMatchObject({ publicId, url: url(`${publicId}.jpg`), subidoPorId: 'estilista-yo', consentimientoId: null });
      expect(cloudinary.recurso).toHaveBeenCalledWith(publicId);
      expect(prisma.db.firmas[0].usadaEn).toBeInstanceOf(Date);
    });

    it('con una URL escrita a mano: 400 en español, aunque traiga también un public_id válido', async () => {
      for (const cuerpo of [
        { url: url('galeria/a.jpg'), alt: 'Foto' },
        { url: 'https://example.com/a.jpg', alt: 'Foto' },
        { publicId: firmar('estilista-yo'), url: url('galeria/a.jpg'), alt: 'Foto' },
      ]) {
        const res = await pedir('POST', '', 'estilista-yo', cuerpo);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toMatch(/url|public_id|subida/i);
      }
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it.each([
      ['que no salió de una firma propia', 'galeria/panel_00000000000000000000000000000999'],
      ['de una imagen de servicios', 'servicios/corte'],
      ['de galería sin el prefijo del panel', 'galeria/abc123'],
      ['con salto de carpeta', 'galeria/../servicios/x'],
      ['vacío', ''],
    ])('public_id %s: 400 en español', async (_caso, publicId) => {
      const res = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Foto' });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/subida|panel|foto/i);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('la firma de otra persona: 400', async () => {
      const res = await pedir('POST', '', 'empleado-yo', { publicId: firmar('estilista-yo'), alt: 'Foto' });
      expect(res.status).toBe(400);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('una firma vencida: 400', async () => {
      const publicId = firmar('estilista-yo', { venceEn: new Date(Date.now() - 1000) });
      const res = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Foto' });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/venci/i);
    });

    it('reutilizar una firma ya usada: 400 y no se duplica la foto', async () => {
      const publicId = firmar('estilista-yo');
      expect((await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Foto' })).status).toBe(201);
      const otra = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Otra vez' });
      expect(otra.status).toBe(400);
      expect((await otra.json()).message).toMatch(/ya se registr/i);
      expect(prisma.db.fotos).toHaveLength(1);
    });

    it('si la imagen no existe en Cloudinary: 400 y la firma sigue sin usar (se puede volver a subir)', async () => {
      cloudinary.recurso.mockResolvedValueOnce(null);
      const publicId = firmar('estilista-yo');
      const res = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Foto' });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/Cloudinary|vuelve a subir/i);
      expect(prisma.db.firmas[0].usadaEn).toBeNull();
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('si Cloudinary no responde: 502 y la firma sigue sin usar', async () => {
      cloudinary.recurso.mockRejectedValueOnce(new Error('caída'));
      const publicId = firmar('estilista-yo');
      expect((await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Foto' })).status).toBe(502);
      expect(prisma.db.firmas[0].usadaEn).toBeNull();
    });

    it('visible sin declaración ni autorización: 400 en español', async () => {
      const res = await pedir('POST', '', 'estilista-yo', nueva({ visible: true }));
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/autorización|persona identificable/i);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('oculta y sin revisar sí se puede registrar', async () => {
      const res = await pedir('POST', '', 'empleado-yo', { publicId: firmar('empleado-yo'), alt: 'Foto' });
      expect(res.status).toBe(201);
      expect(prisma.db.fotos[0]).toMatchObject({ visible: false, sinPersonasIdentificables: null });
    });

    it('con la autorización vigente de la clienta se publica y queda ligada a ella', async () => {
      const res = await pedir('POST', '', 'estilista-yo', nueva({ visible: true, consentimientoId: '1' }));
      expect(res.status).toBe(201);
      expect(prisma.db.fotos[0]).toMatchObject({ visible: true, consentimientoId: BigInt(1), sinPersonasIdentificables: false });
    });

    it.each([
      ['revocada después', '2'],
      ['de otro tipo', '5'],
      ['de una visitante sin cuenta', '6'],
      ['inexistente', '999'],
    ])('autorización %s: 400', async (_caso, id) => {
      const res = await pedir('POST', '', 'estilista-yo', nueva({ visible: true, consentimientoId: id }));
      expect(res.status).toBe(400);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('declarar "sin personas" y ligar una autorización a la vez: 400', async () => {
      const res = await pedir('POST', '', 'estilista-yo', nueva({ sinPersonasIdentificables: true, consentimientoId: '1' }));
      expect(res.status).toBe(400);
    });

    it('texto alternativo obligatorio de 1 a 200 caracteres y servicio existente', async () => {
      expect((await pedir('POST', '', 'estilista-yo', nueva({ alt: '   ' }))).status).toBe(400);
      expect((await pedir('POST', '', 'estilista-yo', nueva({ alt: 'a'.repeat(201) }))).status).toBe(400);
      expect((await pedir('POST', '', 'estilista-yo', { publicId: firmar('estilista-yo') })).status).toBe(400);
      const sinServicio = await pedir('POST', '', 'estilista-yo', nueva({ servicioId: 77 }));
      expect(sinServicio.status).toBe(400);
      expect((await sinServicio.json()).message).toMatch(/servicio/i);
      // Ningún rechazo gastó una firma: no se llegó a registrar nada.
      expect(prisma.db.firmas.every((x: any) => x.usadaEn === null)).toBe(true);
    });

    it('una imagen ilustrativa nunca se publica; la firma de galeria/ilustrativas la marca como ilustrativa', async () => {
      const visible = await pedir('POST', '', 'estilista-yo', nueva({ ilustrativa: true, visible: true, sinPersonasIdentificables: true }));
      expect(visible.status).toBe(400);
      expect((await visible.json()).message).toMatch(/ilustrativa/i);
      const publicId = firmar('estilista-yo', { ilustrativa: true });
      const res = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Ilustración' });
      expect(res.status).toBe(201);
      expect(prisma.db.fotos[0]).toMatchObject({ ilustrativa: true, publicId });
      const real = await pedir('POST', '', 'estilista-yo', { publicId: firmar('estilista-yo', { ilustrativa: true }), alt: 'X', ilustrativa: false });
      expect(real.status).toBe(400);
    });

    it('flujo normal: firmar, subir, registrar, ver en el panel, ocultar y eliminar (en Cloudinary también)', async () => {
      const firma = (await (await pedir('POST', '/firma', 'estilista-yo', {})).json()).data;
      const publicId = firma.params.public_id;
      // (la web sube el archivo directo a Cloudinary con esa firma)
      const alta = await pedir('POST', '', 'estilista-yo', { publicId, alt: 'Balayage miel', visible: true, sinPersonasIdentificables: true });
      expect(alta.status).toBe(201);
      const { data: foto } = await alta.json();
      const panel = (await (await pedir('GET', '/panel', 'estilista-yo')).json()).data;
      expect(panel.map((f: any) => f.id)).toContain(foto.id);
      expect((await (await pedir('GET', '', null)).json()).data.map((f: any) => f.id)).toContain(foto.id);
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { visible: false })).status).toBe(200);
      expect((await (await pedir('GET', '', null)).json()).data.map((f: any) => f.id)).not.toContain(foto.id);
      cloudinary.borrar.mockResolvedValue('ok');
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).toHaveBeenCalledWith(publicId);
      expect(prisma.db.fotos).toHaveLength(0);
    });
  });

  describe('GET /api/galeria/panel', () => {
    it('todas las fotos con su revisión, autorización (nombre y fecha, sin contacto) y quién la subió', async () => {
      sembrar(prisma, { id: 1, visible: true, consentimientoId: BigInt(1), sinPersonasIdentificables: false, subidoPorId: 'estilista-yo', servicioId: 1 });
      sembrar(prisma, { id: 2, visible: true, sinPersonasIdentificables: null });
      sembrar(prisma, { id: 3, ilustrativa: true, sinPersonasIdentificables: true });
      sembrar(prisma, { id: 4, consentimientoId: BigInt(2), sinPersonasIdentificables: false });
      const res = await pedir('GET', '/panel', 'becario-yo');
      const texto = await res.text();
      const { data } = JSON.parse(texto);
      expect(data).toHaveLength(4);
      const porId = Object.fromEntries(data.map((f: any) => [f.id, f]));
      expect(porId[1]).toMatchObject({
        revisada: true,
        publicable: true,
        consentimiento: { id: '1', nombre: 'Ana López', fecha: dia(1).toISOString(), vigente: true },
        subidoPor: { nombre: 'Eva Estilista' },
        servicio: { id: 1, nombre: 'Corte de autor' },
      });
      expect(porId[2]).toMatchObject({ revisada: false, publicable: false, consentimiento: null });
      expect(porId[3]).toMatchObject({ revisada: true, publicable: false, ilustrativa: true });
      expect(porId[4]).toMatchObject({ revisada: true, publicable: false, consentimiento: { vigente: false } });
      for (const prohibido of ['correo.test', '771000']) expect(texto).not.toContain(prohibido);
    });

    it('filtros opcionales: servicio, estado e ilustrativa', async () => {
      sembrar(prisma, { id: 1, visible: true, sinPersonasIdentificables: true, servicioId: 1 });
      sembrar(prisma, { id: 2, visible: false, servicioId: 1 });
      sembrar(prisma, { id: 3, visible: false, ilustrativa: true });
      const ids = async (q: string) => ((await (await pedir('GET', `/panel${q}`, 'estilista-yo')).json()).data as any[]).map((f) => f.id);
      expect(await ids('?servicioId=1')).toEqual([1, 2]);
      expect(await ids('?estado=visible')).toEqual([1]);
      expect(await ids('?estado=oculta')).toEqual([2, 3]);
      expect(await ids('?ilustrativa=true')).toEqual([3]);
      expect(await ids('?ilustrativa=false')).toEqual([1, 2]);
      expect((await pedir('GET', '/panel?estado=otra', 'estilista-yo')).status).toBe(400);
    });
  });

  describe('PATCH /api/galeria/:id', () => {
    it('publicar una foto sin revisar exige la declaración o la autorización', async () => {
      const foto = sembrar(prisma, {});
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { visible: true })).status).toBe(400);
      const res = await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { visible: true, sinPersonasIdentificables: true, alt: ' Nuevo texto ' });
      expect(res.status).toBe(200);
      expect(prisma.db.fotos[0]).toMatchObject({ visible: true, sinPersonasIdentificables: true, alt: 'Nuevo texto' });
    });

    it('cambiar a "aparece una clienta" quita la declaración y liga la autorización', async () => {
      const foto = sembrar(prisma, { visible: true, sinPersonasIdentificables: true });
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { consentimientoId: '4' })).status).toBe(200);
      expect(prisma.db.fotos[0]).toMatchObject({ visible: true, sinPersonasIdentificables: false, consentimientoId: BigInt(4) });
      // Sin autorización ya no puede seguir publicada
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { consentimientoId: null })).status).toBe(400);
    });

    it('una foto anterior ya publicada y sin revisar se puede editar sin revisarla', async () => {
      const foto = sembrar(prisma, { visible: true, sinPersonasIdentificables: null });
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { alt: 'Texto mejor', visible: true })).status).toBe(200);
    });

    it('marcarla como ilustrativa la oculta; pedir ilustrativa y visible a la vez es 400', async () => {
      const foto = sembrar(prisma, { visible: true, sinPersonasIdentificables: true });
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { ilustrativa: true, visible: true })).status).toBe(400);
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { ilustrativa: true })).status).toBe(200);
      expect(prisma.db.fotos[0]).toMatchObject({ ilustrativa: true, visible: false });
    });

    it('una subida a galeria/ilustrativas no deja de ser ilustrativa', async () => {
      const foto = sembrar(prisma, { url: url('galeria/ilustrativas/y.png'), publicId: 'galeria/ilustrativas/y', ilustrativa: true });
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { ilustrativa: false })).status).toBe(400);
    });

    it('foto inexistente: 404; campos que no se editan: 400', async () => {
      expect((await pedir('PATCH', '/999', 'estilista-yo', { alt: 'x' })).status).toBe(404);
      const foto = sembrar(prisma, {});
      expect((await pedir('PATCH', `/${foto.id}`, 'estilista-yo', { url: url('galeria/otra.jpg') })).status).toBe(400);
    });
  });

  describe('PUT /api/galeria/orden', () => {
    it('reordena según la lista recibida', async () => {
      sembrar(prisma, { id: 1, orden: 0 });
      sembrar(prisma, { id: 2, orden: 1 });
      sembrar(prisma, { id: 3, orden: 2 });
      expect((await pedir('PUT', '/orden', 'estilista-yo', { ids: [3, 1, 2] })).status).toBe(200);
      expect(Object.fromEntries(prisma.db.fotos.map((f: any) => [f.id, f.orden]))).toEqual({ 1: 1, 2: 2, 3: 0 });
    });

    it('ids repetidos, vacíos o que no existen: 400', async () => {
      sembrar(prisma, { id: 1 });
      expect((await pedir('PUT', '/orden', 'estilista-yo', { ids: [1, 1] })).status).toBe(400);
      expect((await pedir('PUT', '/orden', 'estilista-yo', { ids: [] })).status).toBe(400);
      expect((await pedir('PUT', '/orden', 'estilista-yo', { ids: [1, 50] })).status).toBe(400);
    });
  });

  describe('DELETE /api/galeria/:id', () => {
    it('borra en Cloudinary y luego la fila', async () => {
      const foto = sembrar(prisma, { visible: true, sinPersonasIdentificables: true });
      cloudinary.borrar.mockResolvedValue('ok');
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).toHaveBeenCalledWith(foto.publicId);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('si Cloudinary ya no la tiene, igual borra la fila', async () => {
      const foto = sembrar(prisma, {});
      cloudinary.borrar.mockResolvedValue('no_encontrada');
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('sin public_id guardado (foto sembrada desde los servicios) no toca Cloudinary: la imagen sigue siendo del servicio', async () => {
      const foto = sembrar(prisma, { publicId: null, url: url('servicios/corte.webp') });
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).not.toHaveBeenCalled();
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('un public_id fuera de la carpeta galeria no se borra en Cloudinary', async () => {
      const foto = sembrar(prisma, { publicId: 'productos/shampoo', url: url('productos/shampoo.jpg') });
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).not.toHaveBeenCalled();
    });

    it('si otra foto de la galería usa la misma imagen, solo se borra la fila', async () => {
      const a = sembrar(prisma, { publicId: 'galeria/compartida', url: url('galeria/compartida.jpg') });
      sembrar(prisma, { publicId: 'galeria/compartida', url: url('galeria/compartida.jpg') });
      expect((await pedir('DELETE', `/${a.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).not.toHaveBeenCalled();
      expect(prisma.db.fotos).toHaveLength(1);
    });

    it('si la imagen la usa un servicio (u otra parte del sitio), solo se quita la fila: nunca se destruye en Cloudinary', async () => {
      const foto = sembrar(prisma, { publicId: 'galeria/panel_00000000000000000000000000000005', url: url('galeria/panel_00000000000000000000000000000005.jpg') });
      prisma.db.usos.push(url('galeria/panel_00000000000000000000000000000005.jpg'));
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).not.toHaveBeenCalled();
      expect(prisma.db.fotos).toHaveLength(0);
    });

    it('la revisión de uso cubre servicios, presentaciones, equipo, configuración del sitio, promociones y usuarios', async () => {
      const foto = sembrar(prisma, {});
      cloudinary.borrar.mockResolvedValue('ok');
      await pedir('DELETE', `/${foto.id}`, 'estilista-yo');
      for (const tabla of ['servicios', 'producto_presentaciones', 'perfiles_empleado', 'configuracion_sitio', 'promociones', 'usuarios', 'galeria_fotos']) {
        expect(prisma.db.consultaUso).toContain(tabla);
      }
    });

    it('si no se puede revisar el uso, no se destruye en Cloudinary (se quita solo la fila)', async () => {
      const foto = sembrar(prisma, {});
      prisma.$queryRaw.mockRejectedValueOnce(new Error('sin base'));
      expect((await pedir('DELETE', `/${foto.id}`, 'estilista-yo')).status).toBe(200);
      expect(cloudinary.borrar).not.toHaveBeenCalled();
    });

    it('si Cloudinary falla: la foto se oculta, la fila se queda y responde 502 en español', async () => {
      const foto = sembrar(prisma, { visible: true, sinPersonasIdentificables: true });
      cloudinary.borrar.mockRejectedValue(new Error('caída'));
      const res = await pedir('DELETE', `/${foto.id}`, 'estilista-yo');
      expect(res.status).toBe(502);
      expect((await res.json()).message).toMatch(/Cloudinary.*intenta/i);
      expect(prisma.db.fotos).toHaveLength(1);
      expect(prisma.db.fotos[0].visible).toBe(false);
    });

    it('foto inexistente: 404', async () => {
      expect((await pedir('DELETE', '/999', 'estilista-yo')).status).toBe(404);
    });
  });

  describe('GET /api/galeria/autorizaciones', () => {
    it('clientas con cuenta activa y autorización vigente que coinciden por nombre: id del consentimiento, nombre y fecha, sin contacto', async () => {
      const res = await pedir('GET', '/autorizaciones?q=ana', 'estilista-yo');
      const texto = await res.text();
      const { data } = JSON.parse(texto);
      expect(data).toEqual(
        expect.arrayContaining([
          { consentimientoId: '1', nombre: 'Ana López', fecha: dia(1).toISOString() },
          { consentimientoId: '4', nombre: 'Ana María Gil', fecha: dia(4).toISOString() },
        ]),
      );
      expect(data).toHaveLength(2);
      expect(texto).not.toContain('correo.test');
      expect(texto).not.toContain('clienta-');
    });

    it('la que revocó no aparece; con menos de 2 letras no busca', async () => {
      expect((await (await pedir('GET', '/autorizaciones?q=beatriz', 'estilista-yo')).json()).data).toEqual([]);
      expect((await (await pedir('GET', '/autorizaciones?q=a', 'estilista-yo')).json()).data).toEqual([]);
    });
  });
});

describe('validarUrlGaleria', () => {
  it('acepta la carpeta galeria y galeria/ilustrativas, con o sin versión, y devuelve el public_id', () => {
    expect(validarUrlGaleria(url('galeria/a.jpg'), NUBE)).toEqual({ publicId: 'galeria/a', enIlustrativas: false });
    expect(validarUrlGaleria(`https://res.cloudinary.com/${NUBE}/image/upload/galeria/ilustrativas/b.png`, NUBE)).toEqual({
      publicId: 'galeria/ilustrativas/b',
      enIlustrativas: true,
    });
  });

  it('sin la nube configurada no acepta nada', () => {
    expect(validarUrlGaleria(url('galeria/a.jpg'), undefined)).toBeNull();
  });

  it('rechaza carpetas que solo empiezan igual', () => {
    expect(validarUrlGaleria(url('galeria-falsa/a.jpg'), NUBE)).toBeNull();
    expect(validarUrlGaleria(url('galeria/'), NUBE)).toBeNull();
  });
});

describe('borrarImagenCloudinary', () => {
  const VARIABLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  const originales = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
  const SECRETO = 'secreto-falso-de-prueba';
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = NUBE;
    process.env.CLOUDINARY_API_KEY = '000000000000000';
    process.env.CLOUDINARY_API_SECRET = SECRETO;
  });
  afterAll(() => {
    for (const v of VARIABLES) {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    }
  });

  it('llama a destroy con la firma de public_id y timestamp, sin mandar el secreto', async () => {
    const fetchFalso = jest.fn(async () => new Response(JSON.stringify({ result: 'ok' }), { status: 200 }));
    await expect(borrarImagenCloudinary('galeria/a', { fetchImpl: fetchFalso as any, ahoraMs: 1_700_000_000_000 })).resolves.toBe('ok');
    const [destino, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(destino).toBe(`https://api.cloudinary.com/v1_1/${NUBE}/image/destroy`);
    const cuerpo = new URLSearchParams(String(init.body));
    expect(cuerpo.get('public_id')).toBe('galeria/a');
    expect(cuerpo.get('timestamp')).toBe('1700000000');
    expect(cuerpo.get('api_key')).toBe('000000000000000');
    expect(cuerpo.get('signature')).toBe(firmarParametrosCloudinary({ public_id: 'galeria/a', timestamp: '1700000000' }, SECRETO));
    expect(String(init.body)).not.toContain(SECRETO);
  });

  it('"not found" cuenta como ya borrada; otro resultado o un error HTTP lanzan', async () => {
    const responde = (cuerpo: unknown, status = 200) => jest.fn(async () => new Response(JSON.stringify(cuerpo), { status })) as any;
    await expect(borrarImagenCloudinary('galeria/a', { fetchImpl: responde({ result: 'not found' }) })).resolves.toBe('no_encontrada');
    await expect(borrarImagenCloudinary('galeria/a', { fetchImpl: responde({ error: { message: 'x' } }, 500) })).rejects.toThrow();
    await expect(borrarImagenCloudinary('galeria/a', { fetchImpl: responde({ result: 'error' }) })).rejects.toThrow();
  });

  it('sin credenciales configuradas lanza', async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    await expect(borrarImagenCloudinary('galeria/a', { fetchImpl: jest.fn() as any })).rejects.toThrow();
  });
});

describe('Firma y consulta de una foto del panel en Cloudinary', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env = { ...ENV, CLOUDINARY_CLOUD_NAME: 'nube-x', CLOUDINARY_API_KEY: 'llave-x', CLOUDINARY_API_SECRET: 'secreto-x' };
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('el public_id nuevo es irrepetible y con el prefijo del panel', () => {
    const a = nuevoPublicId('galeria', false);
    expect(a).toMatch(/^galeria\/panel_[0-9a-f]{32}$/);
    expect(nuevoPublicId('galeria', true)).toMatch(/^galeria\/ilustrativas\/panel_[0-9a-f]{32}$/);
    expect(nuevoPublicId('galeria', false)).not.toBe(a);
  });

  it('firma public_id, overwrite=false, formatos y timestamp (sin carpeta ni secreto en la respuesta)', () => {
    const firma = crearFirmaFotoGaleria('galeria/panel_' + 'a'.repeat(32), 1_700_000_000_000);
    expect(firma.params).toEqual({ allowed_formats: 'jpg,jpeg,png,webp', overwrite: 'false', public_id: 'galeria/panel_' + 'a'.repeat(32), timestamp: '1700000000' });
    expect(firma.signature).toBe(firmarParametrosCloudinary(firma.params, 'secreto-x'));
    expect(JSON.stringify(firma)).not.toContain('secreto-x');
  });

  it('consulta la imagen con la API de administración: datos si existe, null si no, error si Cloudinary falla o no coincide', async () => {
    const id = 'galeria/panel_' + 'b'.repeat(32);
    const llamadas: Array<[string, any]> = [];
    const responde = (cuerpo: unknown, status = 200) =>
      jest.fn(async (u: string, init: any) => {
        llamadas.push([u, init]);
        return { ok: status < 400, status, json: async () => cuerpo } as Response;
      });
    await expect(consultarRecursoCloudinary(id, responde({ public_id: id, version: 1700000001, format: 'PNG' }) as any)).resolves.toEqual({ version: 1700000001, format: 'png' });
    expect(llamadas[0][0]).toBe(`https://api.cloudinary.com/v1_1/nube-x/resources/image/upload/${id}`);
    expect(llamadas[0][1].headers.Authorization).toBe(`Basic ${Buffer.from('llave-x:secreto-x').toString('base64')}`);
    expect(llamadas[0][0]).not.toContain('secreto-x');
    await expect(consultarRecursoCloudinary(id, responde({}, 404) as any)).resolves.toBeNull();
    await expect(consultarRecursoCloudinary(id, responde({}, 500) as any)).rejects.toThrow();
    await expect(consultarRecursoCloudinary(id, responde({ public_id: 'galeria/otra', version: 1, format: 'jpg' }) as any)).rejects.toThrow();
  });

  it('la URL pública la arma el servidor con la versión y el formato que devolvió Cloudinary', () => {
    expect(urlPublicaGaleria('galeria/panel_' + 'c'.repeat(32), { version: 17, format: 'webp' }, 'nube-x')).toBe(
      `https://res.cloudinary.com/nube-x/image/upload/v17/galeria/panel_${'c'.repeat(32)}.webp`,
    );
  });
});
