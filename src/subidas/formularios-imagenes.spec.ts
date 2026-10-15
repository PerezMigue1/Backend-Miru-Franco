import { BadRequestException } from '@nestjs/common';
import { ImagenesSubidasService } from './imagenes-subidas.service';
import { MENSAJE_URL_A_MANO } from './imagenes-subidas';
import { ServiciosService } from '../servicios/servicios.service';
import { ProductosService } from '../productos/productos.service';
import { ContenidoService } from '../contenido/contenido.service';
import { ConfiguracionSitioService } from '../configuracion-sitio/configuracion-sitio.service';

/**
 * Cada formulario que guarda una imagen (servicios, productos y presentaciones, equipo, promociones y contenido del
 * sitio) solo acepta las imágenes que ya tenía (se siguen viendo igual) o una subida propia de SU carpeta hecha con el
 * botón "Subir foto". Una URL de imagen escrita a mano se rechaza con 400.
 */
const NUBE = 'nube-x';
const HORA = 60 * 60 * 1000;
const ANTERIOR = 'https://res.cloudinary.com/nube-x/image/upload/v1/foto-anterior.jpg';
const A_MANO = 'https://res.cloudinary.com/nube-x/image/upload/v1/pegada-a-mano.jpg';
const pid = (uso: string, n: number) => `${uso}/panel_${String(n).padStart(32, '0')}`;
const urlDe = (publicId: string) => `https://res.cloudinary.com/${NUBE}/image/upload/v1700000000/${publicId}.jpg`;

/** Servicio real de subidas con su base falsa de firmas; `emitir` simula una firma pedida por u-1. */
function subidasReales() {
  const firmas: any[] = [];
  const prisma: any = {
    firmaSubida: {
      findUnique: jest.fn(async ({ where }: any) => firmas.find((f) => f.publicId === where.publicId) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const lista = firmas.filter((f) => f.id === where.id && f.usadaEn === null);
        for (const f of lista) Object.assign(f, data);
        return { count: lista.length };
      }),
    },
  };
  const cloudinary = { borrar: jest.fn(), recurso: jest.fn(async () => ({ version: 1700000000, format: 'jpg' })) };
  const subidas = new ImagenesSubidasService(prisma, cloudinary as any);
  const emitir = (uso: string, n: number) => {
    const publicId = pid(uso, n);
    firmas.push({ id: firmas.length + 1, uso, publicId, usuarioId: 'u-1', ilustrativa: false, venceEn: new Date(Date.now() + HORA), usadaEn: null });
    return publicId;
  };
  return { subidas, firmas, emitir };
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, CLOUDINARY_CLOUD_NAME: NUBE, CLOUDINARY_API_KEY: 'llave-x', CLOUDINARY_API_SECRET: 'secreto-x' };
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...ENV };
  jest.restoreAllMocks();
});

describe('Servicios: imágenes del servicio', () => {
  function montar(imagenGuardada: string[] = [ANTERIOR]) {
    const { subidas, emitir, firmas } = subidasReales();
    const prisma: any = {
      servicio: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        findUnique: jest.fn(async () => ({ id: 1, nombre: 'Corte', precio: 300, anticipoMonto: null, imagen: imagenGuardada })),
        update: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      },
    };
    return { servicio: new ServiciosService(prisma, subidas), prisma, emitir, firmas };
  }
  const base = { nombre: 'Corte', categoria: 'Cabello', precio: 300, duracionMinutos: 60 } as any;

  it('al crear: una subida propia de servicios/ se guarda con la URL que arma el servidor', async () => {
    const { servicio, prisma, emitir } = montar();
    const nueva = emitir('servicios', 1);
    await servicio.crear({ ...base, imagen: [nueva] }, 'u-1');
    expect(prisma.servicio.create.mock.calls[0][0].data.imagen).toEqual([urlDe(nueva)]);
  });

  it.each([
    ['una URL escrita a mano', A_MANO],
    ['una subida de productos/', pid('productos', 7)],
    ['una subida de la galería', pid('galeria', 7)],
  ])('al crear con %s: 400 y no se guarda', async (_c, valor) => {
    const { servicio, prisma } = montar();
    await expect(servicio.crear({ ...base, imagen: [valor] }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.servicio.create).not.toHaveBeenCalled();
  });

  it('al editar: las imágenes que ya tenía se conservan igual; una nueva solo como subida propia; una URL a mano es 400', async () => {
    const { servicio, prisma, emitir } = montar();
    await servicio.actualizar(1, { imagen: [ANTERIOR] } as any, 'u-1');
    expect(prisma.servicio.update.mock.calls[0][0].data.imagen).toEqual([ANTERIOR]);
    const nueva = emitir('servicios', 2);
    await servicio.actualizar(1, { imagen: [ANTERIOR, nueva] } as any, 'u-1');
    expect(prisma.servicio.update.mock.calls[1][0].data.imagen).toEqual([ANTERIOR, urlDe(nueva)]);
    await expect(servicio.actualizar(1, { imagen: [ANTERIOR, A_MANO] } as any, 'u-1')).rejects.toThrow(MENSAJE_URL_A_MANO);
    expect(prisma.servicio.update).toHaveBeenCalledTimes(2);
  });

  it('quitar todas las imágenes sí se puede', async () => {
    const { servicio, prisma } = montar();
    await servicio.actualizar(1, { imagen: [] } as any, 'u-1');
    expect(prisma.servicio.update.mock.calls[0][0].data.imagen).toEqual([]);
  });
});

describe('Productos: imágenes de cada presentación', () => {
  function montar() {
    const { subidas, emitir } = subidasReales();
    const presentaciones = [{ id: 10, productoId: 1, tamanio: '100 ml', imagenes: [ANTERIOR], precio: 100, stock: 1, disponible: true }];
    const tx: any = {
      producto: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => ({ id: 1, presentaciones })) },
      productoPresentacion: {
        findMany: jest.fn(async () => presentaciones),
        update: jest.fn(async ({ data }: any) => data),
        create: jest.fn(async ({ data }: any) => data),
        delete: jest.fn(),
      },
      pedidoItem: { count: jest.fn(async () => 0) },
    };
    const prisma: any = {
      producto: { create: jest.fn(async ({ data }: any) => ({ id: 1, ...data, presentaciones: data.presentaciones?.create ?? [] })), findUnique: jest.fn(async () => ({ id: 1 })) },
      productoPresentacion: tx.productoPresentacion,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { servicio: new ProductosService(prisma, subidas), prisma, tx, emitir };
  }

  it('al crear: una subida propia de productos/ se guarda con su URL; una URL a mano es 400', async () => {
    const { servicio, prisma, emitir } = montar();
    const nueva = emitir('productos', 1);
    await servicio.crear({ nombre: 'Fluido', marca: 'AVYNA', presentaciones: [{ tamanio: '100 ml', imagenes: [nueva], precio: 1, stock: 1 }] } as any, 'u-1');
    expect(prisma.producto.create.mock.calls[0][0].data.presentaciones.create[0].imagenes).toEqual([urlDe(nueva)]);
    await expect(
      servicio.crear({ nombre: 'Fluido', marca: 'AVYNA', presentaciones: [{ tamanio: '100 ml', imagenes: [A_MANO], precio: 1, stock: 1 }] } as any, 'u-1'),
    ).rejects.toThrow(MENSAJE_URL_A_MANO);
  });

  it('al editar: las imágenes que ya tenía el producto se conservan (también en otra presentación); una nueva solo como subida propia', async () => {
    const { servicio, tx, emitir } = montar();
    const nueva = emitir('productos', 2);
    await servicio.actualizar(1, {
      presentaciones: [
        { id: 10, tamanio: '100 ml', imagenes: [ANTERIOR, nueva], precio: 100, stock: 1 },
        { tamanio: '250 ml', imagenes: [ANTERIOR], precio: 200, stock: 1 },
      ],
    } as any, 'u-1');
    expect(tx.productoPresentacion.update.mock.calls[0][0].data.imagenes).toEqual([ANTERIOR, urlDe(nueva)]);
    expect(tx.productoPresentacion.create.mock.calls[0][0].data.imagenes).toEqual([ANTERIOR]);
    await expect(
      servicio.actualizar(1, { presentaciones: [{ id: 10, tamanio: '100 ml', imagenes: [A_MANO], precio: 100, stock: 1 }] } as any, 'u-1'),
    ).rejects.toThrow(MENSAJE_URL_A_MANO);
  });
});

describe('Contenido: promociones y foto del equipo', () => {
  function montar() {
    const { subidas, emitir } = subidasReales();
    const promo = { id: 3, titulo: 'Promo', descripcion: 'Texto', imagenUrl: ANTERIOR, enlace: null, desde: null, hasta: null, activa: true, destacada: false, orden: 0 };
    const perfil = { id: 4, activo: true, puesto: 'Estilista', fotoPublica: ANTERIOR, mostrarEnSitio: true, bioPublica: null, ordenPublico: 0, usuario: { nombre: 'Eva' } };
    const prisma: any = {
      promocion: {
        create: jest.fn(async ({ data }: any) => ({ ...promo, ...data })),
        findUnique: jest.fn(async () => promo),
        update: jest.fn(async ({ data }: any) => ({ ...promo, ...data })),
      },
      perfilEmpleado: {
        findUnique: jest.fn(async () => perfil),
        update: jest.fn(async ({ data }: any) => ({ ...perfil, ...data })),
      },
    };
    return { servicio: new ContenidoService(prisma, subidas), prisma, emitir };
  }

  it('promoción: subida propia de promociones/ se guarda con su URL; la actual se conserva; null la quita; una URL a mano es 400', async () => {
    const { servicio, prisma, emitir } = montar();
    const nueva = emitir('promociones', 1);
    await servicio.crearPromocion({ titulo: 'Nueva', descripcion: 'Texto', imagenUrl: nueva } as any, 'u-1');
    expect(prisma.promocion.create.mock.calls[0][0].data.imagenUrl).toBe(urlDe(nueva));
    await expect(servicio.crearPromocion({ titulo: 'Nueva', descripcion: 'Texto', imagenUrl: A_MANO } as any, 'u-1')).rejects.toThrow(MENSAJE_URL_A_MANO);
    await servicio.actualizarPromocion(3, { imagenUrl: ANTERIOR } as any, 'u-1');
    expect(prisma.promocion.update.mock.calls[0][0].data.imagenUrl).toBe(ANTERIOR);
    await servicio.actualizarPromocion(3, { imagenUrl: null } as any, 'u-1');
    expect(prisma.promocion.update.mock.calls[1][0].data.imagenUrl).toBeNull();
    await expect(servicio.actualizarPromocion(3, { imagenUrl: pid('equipo', 9) } as any, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('equipo: subida propia de equipo/ se guarda con su URL; una URL a mano es 400', async () => {
    const { servicio, prisma, emitir } = montar();
    const nueva = emitir('equipo', 1);
    await servicio.actualizarPerfilPublico(4, { fotoPublica: nueva } as any, 'u-1');
    expect(prisma.perfilEmpleado.update.mock.calls[0][0].data.fotoPublica).toBe(urlDe(nueva));
    await expect(servicio.actualizarPerfilPublico(4, { fotoPublica: A_MANO } as any, 'u-1')).rejects.toThrow(MENSAJE_URL_A_MANO);
  });
});

describe('Configuración del sitio: imagen de "Sobre nosotros"', () => {
  function montar() {
    const { subidas, emitir } = subidasReales();
    const guardada = { titulo: 'Historia', parrafos: ['Uno.'], imagen: '/img/salon.jpg', valores: [] };
    const tx: any = {
      $executeRaw: jest.fn(async () => 1),
      configuracionSitio: { findUnique: jest.fn(async () => ({ clave: 'contenido_sobre_nosotros', valor: guardada })), upsert: jest.fn(async () => ({})) },
      historialConfiguracionSitio: { create: jest.fn(async () => ({})) },
    };
    const prisma: any = {
      configuracionSitio: { findUnique: tx.configuracionSitio.findUnique },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    return { servicio: new ConfiguracionSitioService(prisma, subidas), tx, emitir, guardada };
  }

  it('la imagen que ya estaba se conserva; una subida propia de sitio/ se guarda con su URL; una URL a mano es 400', async () => {
    const { servicio, tx, emitir, guardada } = montar();
    await servicio.guardar('contenido_sobre_nosotros', guardada, 'u-1');
    expect(tx.configuracionSitio.upsert.mock.calls[0][0].update.valor.imagen).toBe('/img/salon.jpg');
    const nueva = emitir('sitio', 1);
    await servicio.guardar('contenido_sobre_nosotros', { ...guardada, imagen: nueva }, 'u-1');
    expect(tx.configuracionSitio.upsert.mock.calls[1][0].update.valor.imagen).toBe(urlDe(nueva));
    await expect(servicio.guardar('contenido_sobre_nosotros', { ...guardada, imagen: A_MANO }, 'u-1')).rejects.toThrow(MENSAJE_URL_A_MANO);
    await expect(servicio.guardar('contenido_sobre_nosotros', { ...guardada, imagen: '/img/otra.jpg' }, 'u-1')).rejects.toThrow(MENSAJE_URL_A_MANO);
  });
});

describe('Usuarios: foto de otra persona que guarda el admin (PUT /api/usuarios/:id)', () => {
  function montar(fotoGuardada: string | null = ANTERIOR) {
    const { subidas, emitir } = subidasReales();
    const prisma: any = { usuario: { findUnique: jest.fn(async () => ({ foto: fotoGuardada })) } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UsuariosService } = require('../usuarios/usuarios.service');
    const servicio = new UsuariosService(prisma, {} as any, {} as any, {} as any, subidas);
    const foto = (valor: unknown) => (servicio as any).fotoSubidaPorAdmin('cli-1', valor, { formulario: 'admin-usuario', contexto: { ip: null, userAgent: null }, registradoPorId: 'u-1' });
    return { foto, emitir };
  }

  it('la que ya tenía se conserva, se puede quitar y una subida propia de usuarios/ se guarda con su URL', async () => {
    const { foto, emitir } = montar();
    await expect(foto(undefined)).resolves.toBeUndefined();
    await expect(foto(ANTERIOR)).resolves.toBe(ANTERIOR);
    await expect(foto('')).resolves.toBeNull();
    const nueva = emitir('usuarios', 1);
    await expect(foto(nueva)).resolves.toBe(urlDe(nueva));
  });

  it('una URL escrita a mano o una subida de otra carpeta: 400', async () => {
    const { foto, emitir } = montar();
    await expect(foto(A_MANO)).rejects.toThrow(MENSAJE_URL_A_MANO);
    await expect(foto(emitir('equipo', 2))).rejects.toBeInstanceOf(BadRequestException);
  });
});
