import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ImagenesSubidasService, INTERVALO_LIMPIEZA_FIRMAS_MS } from './imagenes-subidas.service';
import { FirmaImagenDto, ImagenesSubidasController } from './imagenes-subidas.controller';
import { MENSAJE_URL_A_MANO, PERMISO_POR_USO, esPublicIdDe, nuevoPublicId } from './imagenes-subidas';

/**
 * Subida segura de imágenes para los formularios (servicios, productos, equipo, promociones y sitio) y la galería:
 * el servidor firma UNA subida con un public_id que él genera en la carpeta del uso y solo acepta imágenes que
 * salieron de una firma propia, vigente y sin usar. Una URL de imagen escrita a mano se rechaza con 400.
 */
const NUBE = 'nube-x';
const HORA = 60 * 60 * 1000;
const pid = (uso: string, n: number, ilus = false) => `${uso}/${ilus ? 'ilustrativas/' : ''}panel_${String(n).padStart(32, '0')}`;
const urlDe = (publicId: string) => `https://res.cloudinary.com/${NUBE}/image/upload/v1700000000/${publicId}.jpg`;

function montar() {
  const firmas: any[] = [];
  const usos: string[] = [];
  const prisma: any = {
    firmas,
    usos,
    firmaSubida: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: firmas.length + 1, usadaEn: null, creadoEn: new Date(), ...data };
        firmas.push(fila);
        return fila;
      }),
      findUnique: jest.fn(async ({ where }: any) => firmas.find((f) => f.publicId === where.publicId) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const lista = firmas.filter((f) => f.id === where.id && f.usadaEn === null && (!where.venceEn?.gt || f.venceEn > where.venceEn.gt));
        for (const f of lista) Object.assign(f, data);
        return { count: lista.length };
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        firmas.filter((f) => f.usadaEn === null && f.venceEn < where.venceEn.lt).slice(0, take).map((f) => ({ id: f.id, publicId: f.publicId })),
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        const i = firmas.findIndex((f) => f.id === where.id && f.usadaEn === null);
        if (i < 0) return { count: 0 };
        firmas.splice(i, 1);
        return { count: 1 };
      }),
    },
    $queryRaw: jest.fn(async (_partes: TemplateStringsArray, ...valores: unknown[]) => [{ en_uso: usos.some((u) => u.includes(String(valores[0]))) }]),
  };
  const cloudinary = {
    borrar: jest.fn(async () => 'ok' as const),
    recurso: jest.fn(async () => ({ version: 1700000000, format: 'jpg' }) as { version: number; format: string } | null),
  };
  const servicio = new ImagenesSubidasService(prisma, cloudinary as any);
  /** Firma emitida directamente en la base (como si se hubiera pedido antes). */
  const emitida = (uso: string, n: number, quien = 'u-1', extra: Record<string, unknown> = {}) => {
    const publicId = pid(uso, n, !!extra.ilustrativa);
    firmas.push({ id: firmas.length + 1, uso, publicId, usuarioId: quien, ilustrativa: false, venceEn: new Date(Date.now() + HORA), usadaEn: null, ...extra });
    return publicId;
  };
  return { servicio, prisma, cloudinary, firmas, usos, emitida };
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, CLOUDINARY_CLOUD_NAME: NUBE, CLOUDINARY_API_KEY: 'llave-x', CLOUDINARY_API_SECRET: 'secreto-x' };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...ENV };
  jest.restoreAllMocks();
});

describe('Firma de una imagen por uso', () => {
  it.each(['servicios', 'productos', 'equipo', 'promociones', 'sitio', 'galeria'] as const)(
    '%s: el public_id lo genera el servidor dentro de su carpeta (nunca en galeria/ salvo la galería) y la firma se guarda vigente una hora',
    async (uso) => {
      const { servicio, firmas } = montar();
      const { data } = await servicio.firmar('u-1', uso);
      expect(data.params.public_id).toMatch(new RegExp(`^${uso}/panel_[0-9a-f]{32}$`));
      if (uso !== 'galeria') expect(data.params.public_id.startsWith('galeria/')).toBe(false);
      expect(data.params.overwrite).toBe('false');
      expect(data.params).not.toHaveProperty('folder');
      expect(JSON.stringify(data)).not.toContain('secreto-x');
      expect(firmas[0]).toMatchObject({ uso, publicId: data.params.public_id, usuarioId: 'u-1', usadaEn: null });
      expect(firmas[0].venceEn.getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);
    },
  );

  it('ilustrativa solo en galería, servicios y sitio (en productos, equipo o promociones se ignora)', async () => {
    const { servicio } = montar();
    expect((await servicio.firmar('u-1', 'servicios', true)).data.params.public_id).toMatch(/^servicios\/ilustrativas\/panel_/);
    expect((await servicio.firmar('u-1', 'productos', true)).data.params.public_id).toMatch(/^productos\/panel_/);
  });

  it('cada uso pide su permiso: servicios y productos servicios:escritura; equipo, promociones y sitio configuracion:editar', async () => {
    const { servicio } = montar();
    const controlador = new ImagenesSubidasController(servicio);
    const pedir = (uso: any, claves: string[]) => controlador.firmar({ uso } as FirmaImagenDto, { id: 'u-1' }, { permisosUsuario: claves });
    await expect(pedir('servicios', ['servicios:escritura'])).resolves.toMatchObject({ success: true });
    await expect(pedir('productos', ['servicios:escritura'])).resolves.toMatchObject({ success: true });
    expect(() => pedir('equipo', ['servicios:escritura'])).toThrow(ForbiddenException);
    expect(() => pedir('sitio', ['galeria:gestionar'])).toThrow(ForbiddenException);
    await expect(pedir('promociones', ['*'])).resolves.toMatchObject({ success: true });
    expect(PERMISO_POR_USO).toMatchObject({ servicios: 'servicios:escritura', productos: 'servicios:escritura', equipo: 'configuracion:editar', promociones: 'configuracion:editar', sitio: 'configuracion:editar' });
  });

  it('el cuerpo solo admite uso e ilustrativa: un uso que no existe es 400', async () => {
    const errores = await validate(plainToInstance(FirmaImagenDto, { uso: 'otra' }));
    expect(errores.length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(FirmaImagenDto, { uso: 'servicios' }))).toHaveLength(0);
  });

  it('nuevoPublicId y esPublicIdDe: irrepetible y solo de su uso', () => {
    const a = nuevoPublicId('servicios', false);
    expect(esPublicIdDe('servicios', a)).toBe(true);
    expect(esPublicIdDe('productos', a)).toBe(false);
    expect(nuevoPublicId('servicios', false)).not.toBe(a);
    expect(esPublicIdDe('servicios', 'servicios/../galeria/x')).toBe(false);
  });
});

describe('Imágenes de un formulario (resolverImagenes)', () => {
  it('conserva tal cual las imágenes que ya tenía y cambia cada public_id propio por la URL que arma el servidor, gastando su firma', async () => {
    const { servicio, emitida, firmas } = montar();
    const nueva = emitida('servicios', 1);
    const anterior = 'https://res.cloudinary.com/nube-x/image/upload/v1/foto-anterior.jpg';
    const r = await servicio.resolverImagenes('u-1', 'servicios', [anterior, nueva], [anterior]);
    expect(r).toEqual([anterior, urlDe(nueva)]);
    expect(firmas[0].usadaEn).toBeInstanceOf(Date);
  });

  it.each([
    ['una URL de Cloudinary escrita a mano', 'https://res.cloudinary.com/nube-x/image/upload/v1/servicios/otra.jpg'],
    ['una URL de otro sitio', 'https://ejemplo.com/a.jpg'],
    ['una ruta local', '/img/a.jpg'],
    ['un public_id de otro uso', pid('productos', 9)],
    ['un public_id de la galería', pid('galeria', 9)],
  ])('%s: 400 en español y no se gasta ninguna firma', async (_caso, valor) => {
    const { servicio, emitida, firmas } = montar();
    const buena = emitida('servicios', 1);
    const error = await servicio.resolverImagenes('u-1', 'servicios', [buena, valor], []).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toMatch(/URL|subida|Subir foto/i);
    expect(firmas[0].usadaEn).toBeNull();
  });

  it('la URL a mano dice que se use "Subir foto"', async () => {
    const { servicio } = montar();
    await expect(servicio.resolverImagenes('u-1', 'equipo', ['https://res.cloudinary.com/nube-x/image/upload/v1/x.jpg'], [])).rejects.toThrow(MENSAJE_URL_A_MANO);
  });

  it('firma de otra persona, vencida o ya usada: 400', async () => {
    const { servicio, emitida } = montar();
    await expect(servicio.resolverImagenes('u-2', 'servicios', [emitida('servicios', 1)], [])).rejects.toThrow(/no salió de una subida/);
    await expect(servicio.resolverImagenes('u-1', 'servicios', [emitida('servicios', 2, 'u-1', { venceEn: new Date(Date.now() - 1) })], [])).rejects.toThrow(/venci/);
    await expect(servicio.resolverImagenes('u-1', 'servicios', [emitida('servicios', 3, 'u-1', { usadaEn: new Date() })], [])).rejects.toThrow(/ya se registr/);
  });

  it('reutilizar una firma ya gastada: 400', async () => {
    const { servicio, emitida } = montar();
    const publicId = emitida('promociones', 1);
    await servicio.resolverImagenes('u-1', 'promociones', [publicId], []);
    await expect(servicio.resolverImagenes('u-1', 'promociones', [publicId], [])).rejects.toThrow(/ya se registr/);
  });

  it('si la imagen no está en Cloudinary: 400 y la firma queda sin usar', async () => {
    const { servicio, emitida, firmas, cloudinary } = montar();
    cloudinary.recurso.mockResolvedValueOnce(null);
    await expect(servicio.resolverImagenes('u-1', 'sitio', [emitida('sitio', 1)], [])).rejects.toThrow(/Cloudinary/);
    expect(firmas[0].usadaEn).toBeNull();
  });

  it('resolverImagen: sin cambio, quitar (null o vacío), conservar la actual o una subida propia', async () => {
    const { servicio, emitida } = montar();
    const actual = 'https://res.cloudinary.com/nube-x/image/upload/v1/equipo/a.jpg';
    await expect(servicio.resolverImagen('u-1', 'equipo', undefined, actual)).resolves.toBeUndefined();
    await expect(servicio.resolverImagen('u-1', 'equipo', null, actual)).resolves.toBeNull();
    await expect(servicio.resolverImagen('u-1', 'equipo', '  ', actual)).resolves.toBeNull();
    await expect(servicio.resolverImagen('u-1', 'equipo', actual, actual)).resolves.toBe(actual);
    const nueva = emitida('equipo', 1);
    await expect(servicio.resolverImagen('u-1', 'equipo', nueva, actual)).resolves.toBe(urlDe(nueva));
    await expect(servicio.resolverImagen('u-1', 'equipo', 'https://otra.com/x.jpg', actual)).rejects.toThrow(MENSAJE_URL_A_MANO);
  });
});

describe('Limpieza periódica de firmas vencidas sin usar', () => {
  it('corre cada hora', () => {
    expect(INTERVALO_LIMPIEZA_FIRMAS_MS).toBe(60 * 60 * 1000);
  });

  it('borra las vencidas sin usar con más de 24 horas y destruye su imagen huérfana; no toca las usadas ni las recientes', async () => {
    const { servicio, emitida, firmas, cloudinary } = montar();
    const vieja = emitida('servicios', 1, 'u-1', { venceEn: new Date(Date.now() - 25 * HORA) });
    emitida('servicios', 2, 'u-1', { venceEn: new Date(Date.now() - 2 * HORA) });
    emitida('galeria', 3, 'u-1', { venceEn: new Date(Date.now() - 30 * HORA), usadaEn: new Date() });
    await expect(servicio.limpiarFirmasVencidas()).resolves.toBe(1);
    expect(cloudinary.borrar).toHaveBeenCalledWith(vieja);
    expect(firmas.map((f) => f.publicId)).toEqual([pid('servicios', 2), pid('galeria', 3)]);
  });

  it('si otra parte del sitio usa la imagen, borra la firma pero nunca destruye la imagen', async () => {
    const { servicio, emitida, firmas, cloudinary, usos } = montar();
    const vieja = emitida('productos', 1, 'u-1', { venceEn: new Date(Date.now() - 25 * HORA) });
    usos.push(urlDe(vieja));
    await servicio.limpiarFirmasVencidas();
    expect(cloudinary.borrar).not.toHaveBeenCalled();
    expect(firmas).toHaveLength(0);
  });

  it('si Cloudinary falla, la firma se queda para la siguiente pasada', async () => {
    const { servicio, emitida, firmas, cloudinary } = montar();
    jest.spyOn((servicio as any).logger, 'warn').mockImplementation(() => undefined);
    emitida('equipo', 1, 'u-1', { venceEn: new Date(Date.now() - 25 * HORA) });
    cloudinary.borrar.mockRejectedValueOnce(new Error('caída'));
    await expect(servicio.limpiarFirmasVencidas()).resolves.toBe(0);
    expect(firmas).toHaveLength(1);
  });

  it('si no se puede revisar el uso, no destruye la imagen', async () => {
    const { servicio, emitida, prisma, cloudinary } = montar();
    jest.spyOn((servicio as any).logger, 'error').mockImplementation(() => undefined);
    emitida('sitio', 1, 'u-1', { venceEn: new Date(Date.now() - 25 * HORA) });
    prisma.$queryRaw.mockRejectedValueOnce(new Error('sin base'));
    await servicio.limpiarFirmasVencidas();
    expect(cloudinary.borrar).not.toHaveBeenCalled();
  });
});

describe('Cableado del módulo de subidas', () => {
  it('la galería importa SubidasModule (con su controlador) y AppModule importa la galería', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SubidasModule } = require('./subidas.module');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GaleriaModule } = require('../galeria/galeria.module');
    expect(Reflect.getMetadata('imports', GaleriaModule)).toContain(SubidasModule);
    expect(Reflect.getMetadata('controllers', SubidasModule)).toContain(ImagenesSubidasController);
    expect(Reflect.getMetadata('providers', SubidasModule)).toContain(ImagenesSubidasService);
  });
});
