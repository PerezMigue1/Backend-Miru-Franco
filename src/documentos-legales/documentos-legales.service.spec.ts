import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { establecerReglasNegocio, REGLAS_POR_OMISION, ReglasNegocio, VARIABLES_REGLAS } from '../configuracion-sitio/reglas-negocio';
import { DocumentosLegalesService, documentosDesactualizados } from './documentos-legales.service';
import { hashTextoVisible, textoVisible } from './html-seguro';

const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
/** 16 de octubre de 2026 a mediodía en México. */
const AHORA = new Date('2026-10-16T18:00:00.000Z');

const PLANTILLA_TERMINOS = '## Compras {#compras-en-linea}\n\nSi no pagas en {plazoPagoLineaHoras} horas, se cancela.\n\n## Garantía {#garantia}\n\nTienes {diasGarantia} días.';
const PLANTILLA_REEMBOLSOS = '## Garantía {#garantia}\n\nTienes {diasGarantia} días.\n\n## Anticipos {#anticipos}\n\nEl anticipo se devuelve.';
const PLANTILLA_AVISO = '## Responsable {#responsable}\n\nMildred.';

function soloInsercion(): never {
  throw new Error('La tabla es de solo inserción');
}

function prismaFalso() {
  let siguienteId = 1;
  const versiones: any[] = [];
  const contenidos: any[] = [];
  const borradores = new Map<string, any>();
  const agregar = (slug: string, version: string, vigenteDesde: string, plantilla: string | null, extra: Record<string, unknown> = {}) => {
    const id = siguienteId++;
    const html = plantilla === null ? null : `<main><p>${slug} ${version}</p></main>`;
    versiones.push({ id, slug, version, hashTexto: html ? hashTextoVisible(html) : 'h-sin-texto', vigenteDesde: dia(vigenteDesde), creadoEn: dia(vigenteDesde) });
    if (plantilla !== null) {
      contenidos.push({
        id,
        versionId: id,
        slug,
        version,
        html,
        plantilla,
        variables: extra.variables ?? {},
        requiereAceptacion: extra.requiereAceptacion ?? true,
        motivo: 'Sembrado',
        publicadoPorId: extra.publicadoPorId ?? null,
        creadoEn: dia(vigenteDesde),
      });
    }
  };
  agregar('terminos', '2.0', '2026-10-14', PLANTILLA_TERMINOS, { variables: { plazoPagoLineaHoras: '24', diasGarantia: '7' } });
  agregar('aviso-privacidad', '2.0', '2026-10-14', PLANTILLA_AVISO);
  agregar('cookies', '1.0', '2026-10-14', null);
  agregar('cookies', '1.1', '2026-10-16', '## Qué son {#que-son}\n\nArchivos.', { requiereAceptacion: false });
  agregar('reembolsos', '1.0', '2026-10-14', PLANTILLA_REEMBOLSOS, { variables: { diasGarantia: '7' } });
  agregar('anticipos', '1.0', '2026-10-14', PLANTILLA_REEMBOLSOS, { variables: { diasGarantia: '7' } });

  const conContenido = (v: any) => ({ ...v, contenido: contenidos.find((c) => c.versionId === v.id) ?? null });
  const filtrar = (where: any = {}) =>
    versiones.filter((v) => {
      if (where.slug?.in && !where.slug.in.includes(v.slug)) return false;
      if (typeof where.slug === 'string' && where.slug !== v.slug) return false;
      if (where.version && where.version !== v.version) return false;
      if (where.vigenteDesde?.lte && v.vigenteDesde > where.vigenteDesde.lte) return false;
      return true;
    });
  const ordenar = (lista: any[]) => [...lista].sort((a, b) => a.vigenteDesde - b.vigenteDesde || a.id - b.id);

  const prisma: any = {
    versiones,
    contenidos,
    borradores,
    versionDocumentoLegal: {
      findMany: jest.fn(async ({ where }: any = {}) => ordenar(filtrar(where)).map(conContenido)),
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const lista = ordenar(filtrar(where));
        return lista.length ? conContenido(lista[lista.length - 1]) : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (versiones.some((v) => v.slug === data.slug && v.version === data.version)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const fila = { id: siguienteId++, creadoEn: AHORA, ...data };
        versiones.push(fila);
        return { ...fila };
      }),
      update: jest.fn(soloInsercion),
      updateMany: jest.fn(soloInsercion),
      upsert: jest.fn(soloInsercion),
      delete: jest.fn(soloInsercion),
      deleteMany: jest.fn(soloInsercion),
    },
    contenidoDocumentoLegal: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: siguienteId++, creadoEn: AHORA, ...data };
        contenidos.push(fila);
        return { ...fila };
      }),
      update: jest.fn(soloInsercion),
      updateMany: jest.fn(soloInsercion),
      upsert: jest.fn(soloInsercion),
      delete: jest.fn(soloInsercion),
      deleteMany: jest.fn(soloInsercion),
    },
    borradorDocumentoLegal: {
      findUnique: jest.fn(async ({ where }: any) => borradores.get(where.slug) ?? null),
      findMany: jest.fn(async () => [...borradores.values()]),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const fila = borradores.has(where.slug) ? { ...borradores.get(where.slug), ...update } : { ...create };
        fila.actualizadoEn = AHORA;
        borradores.set(where.slug, fila);
        return fila;
      }),
      create: jest.fn(async ({ data }: any) => {
        const fila = { ...data, actualizadoEn: AHORA };
        borradores.set(data.slug, fila);
        return fila;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const habia = borradores.delete(where.slug);
        return { count: habia ? 1 : 0 };
      }),
    },
    usuario: { findMany: jest.fn(async () => [{ id: 'admin-1', nombre: 'Mildred' }]) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  return prisma;
}

const montar = () => {
  const prisma = prismaFalso();
  return { prisma, servicio: new DocumentosLegalesService(prisma) };
};

const PUBLICACION = { version: '2.1', vigenteDesde: '2026-10-20', motivo: 'Se aclara el plazo de pago en línea.', requiereAceptacion: true };

function conReglas(cambio: (r: ReglasNegocio) => void) {
  const r = JSON.parse(JSON.stringify(REGLAS_POR_OMISION)) as ReglasNegocio;
  cambio(r);
  return r;
}

afterEach(() => establecerReglasNegocio(null));

describe('DocumentosLegalesService.publicar', () => {
  it('inserta la versión y su contenido en una transacción, con el hash del texto visible y las variables congeladas', async () => {
    const { servicio, prisma } = montar();
    establecerReglasNegocio(conReglas((r) => (r.tienda.plazoPagoLineaHoras = 48)));
    const r = await servicio.publicar('terminos', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const version = prisma.versionDocumentoLegal.create.mock.calls[0][0].data;
    const contenido = prisma.contenidoDocumentoLegal.create.mock.calls[0][0].data;
    expect(version).toMatchObject({ slug: 'terminos', version: '2.1', vigenteDesde: dia('2026-10-20') });
    expect(version.hashTexto).toBe(hashTextoVisible(contenido.html));
    expect(contenido).toMatchObject({ slug: 'terminos', version: '2.1', requiereAceptacion: true, publicadoPorId: 'admin-1', motivo: PUBLICACION.motivo });
    expect(contenido.variables).toEqual({ plazoPagoLineaHoras: '48', diasGarantia: '7' });
    expect(contenido.plantilla).toBe(PLANTILLA_TERMINOS);
    const texto = textoVisible(contenido.html);
    expect(texto).toContain('Si no pagas en 48 horas, se cancela.');
    expect(texto).toContain('Versión 2.1. Vigente desde el 20 de octubre de 2026.');
    expect(r).toMatchObject({ slug: 'terminos', version: '2.1', hash: version.hashTexto, requiereAceptacion: true });
  });

  it('nunca modifica una versión publicada', async () => {
    const { servicio, prisma } = montar();
    await servicio.publicar('terminos', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    for (const tabla of ['versionDocumentoLegal', 'contenidoDocumentoLegal']) {
      for (const m of ['update', 'updateMany', 'upsert', 'delete', 'deleteMany']) expect(prisma[tabla][m]).not.toHaveBeenCalled();
    }
    expect(prisma.versiones.find((v: any) => v.slug === 'terminos' && v.version === '2.0')).toBeTruthy();
  });

  it('por omisión pide volver a aceptar; con requiereAceptacion false es una corrección menor', async () => {
    const { servicio, prisma } = montar();
    await servicio.publicar('terminos', { version: '2.1', vigenteDesde: '2026-10-16', motivo: 'Corrige una errata menor.', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    expect(prisma.contenidoDocumentoLegal.create.mock.calls[0][0].data.requiereAceptacion).toBe(true);
    await servicio.publicar('aviso-privacidad', { version: '2.1', vigenteDesde: '2026-10-16', motivo: 'Corrige una errata menor.', plantilla: PLANTILLA_AVISO, requiereAceptacion: false }, 'admin-1', AHORA);
    expect(prisma.contenidoDocumentoLegal.create.mock.calls[1][0].data.requiereAceptacion).toBe(false);
  });

  it.each([
    ['2.0', /mayor/],
    ['1.9', /mayor/],
    ['2', /X\.Y/],
    ['v2.1', /X\.Y/],
  ])('rechaza la versión %s', async (version, mensaje) => {
    const { servicio, prisma } = montar();
    await expect(servicio.publicar('terminos', { ...PUBLICACION, version, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toThrow(mensaje);
    expect(prisma.versionDocumentoLegal.create).not.toHaveBeenCalled();
  });

  it('acepta una versión mayor (2.1, 2.10 o 3.0)', async () => {
    for (const version of ['2.10', '3.0']) {
      const { servicio } = montar();
      await expect(servicio.publicar('terminos', { ...PUBLICACION, version, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).resolves.toMatchObject({ version });
    }
  });

  it('el motivo es obligatorio', async () => {
    const { servicio } = montar();
    await expect(servicio.publicar('terminos', { ...PUBLICACION, motivo: '  ', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toThrow(/motivo/);
    await expect(servicio.publicar('terminos', { ...PUBLICACION, motivo: 'corto', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toThrow(/motivo/);
  });

  it('la fecha de vigencia es hoy o futura, válida y no anterior a la última versión', async () => {
    const { servicio } = montar();
    await expect(servicio.publicar('terminos', { ...PUBLICACION, vigenteDesde: '2026-10-15', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toThrow(/hoy/);
    await expect(servicio.publicar('terminos', { ...PUBLICACION, vigenteDesde: '2026-02-30', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toThrow(/fecha/);
    await servicio.publicar('terminos', { ...PUBLICACION, vigenteDesde: '2026-11-01', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    await expect(
      servicio.publicar('terminos', { ...PUBLICACION, version: '2.2', vigenteDesde: '2026-10-20', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA),
    ).rejects.toThrow(/2\.1/);
  });

  it('rechaza variables que no existen en las reglas', async () => {
    const { servicio, prisma } = montar();
    await expect(
      servicio.publicar('terminos', { ...PUBLICACION, plantilla: `${PLANTILLA_TERMINOS}\n\nPlazo de {diasInventados} días.` }, 'admin-1', AHORA),
    ).rejects.toThrow(/diasInventados/);
    expect(prisma.versionDocumentoLegal.create).not.toHaveBeenCalled();
  });

  it('rechaza html no permitido (script, on*, javascript:) en vez de publicarlo', async () => {
    const { servicio, prisma } = montar();
    for (const malo of ['<div onclick="x()">Hola</div>', '<div>Hola<script>alert(1)</script></div>', 'Ve a [aquí](javascript:alert(1)).']) {
      await expect(servicio.publicar('terminos', { ...PUBLICACION, plantilla: `${PLANTILLA_TERMINOS}\n\n${malo}` }, 'admin-1', AHORA)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.versionDocumentoLegal.create).not.toHaveBeenCalled();
  });

  it('reembolsos publica también anticipos, con la misma versión y el mismo hash; anticipos no se publica sola', async () => {
    const { servicio, prisma } = montar();
    await servicio.publicar('reembolsos', { ...PUBLICACION, version: '1.1', plantilla: PLANTILLA_REEMBOLSOS }, 'admin-1', AHORA);
    const filas = prisma.versionDocumentoLegal.create.mock.calls.map((c: any) => c[0].data);
    expect(filas.map((f: any) => `${f.slug} ${f.version}`)).toEqual(['reembolsos 1.1', 'anticipos 1.1']);
    expect(filas[0].hashTexto).toBe(filas[1].hashTexto);
    expect(prisma.contenidoDocumentoLegal.create).toHaveBeenCalledTimes(2);
    await expect(servicio.publicar('anticipos', { ...PUBLICACION, version: '1.2', plantilla: PLANTILLA_REEMBOLSOS }, 'admin-1', AHORA)).rejects.toThrow(/reembolsos/i);
  });

  it('dos publicaciones de la misma versión a la vez: la segunda es 409', async () => {
    const { servicio, prisma } = montar();
    prisma.versionDocumentoLegal.findMany.mockImplementationOnce(async () => []);
    prisma.versiones.push({ id: 99, slug: 'terminos', version: '2.1', hashTexto: 'x', vigenteDesde: dia('2026-10-20') });
    await expect(servicio.publicar('terminos', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('al publicar se borra el borrador de ese documento', async () => {
    const { servicio, prisma } = montar();
    await servicio.guardarBorrador('terminos', PLANTILLA_TERMINOS, 'admin-1');
    await servicio.publicar('terminos', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    expect(prisma.borradores.has('terminos')).toBe(false);
  });

  it('un slug que no es documento legal es 404', async () => {
    const { servicio } = montar();
    await expect(servicio.publicar('otro', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentosLegalesService.vigente (público)', () => {
  it('devuelve el html y el hash de la versión vigente, sin datos de quién publicó', async () => {
    const { servicio } = montar();
    const r = await servicio.vigente('cookies', AHORA);
    expect(r).toMatchObject({ slug: 'cookies', version: '1.1', vigenteDesde: '2026-10-16', requiereAceptacion: false });
    expect(r.hash).toBe(hashTextoVisible(r.html as string));
    expect(r).not.toHaveProperty('publicadoPorId');
    expect(r).not.toHaveProperty('motivo');
  });

  it('una versión futura no es la vigente hasta su fecha', async () => {
    const { servicio } = montar();
    await servicio.publicar('terminos', { ...PUBLICACION, vigenteDesde: '2026-11-01', plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    expect((await servicio.vigente('terminos', AHORA)).version).toBe('2.0');
    expect((await servicio.vigente('terminos', new Date('2026-11-01T18:00:00.000Z'))).version).toBe('2.1');
  });

  it('anticipos devuelve la página de reembolsos; un slug desconocido es 404', async () => {
    const { servicio } = montar();
    const a = await servicio.vigente('anticipos', AHORA);
    expect(a).toMatchObject({ slug: 'anticipos', version: '1.0', ruta: '/politica-de-reembolsos#anticipos' });
    await expect(servicio.vigente('nada', AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Variables de reglas en documentos vigentes', () => {
  it('documentosDesactualizados: compara las variables congeladas con las reglas (propuestas o de hoy)', () => {
    const vigentes = [
      { slug: 'terminos', titulo: 'Términos', version: '2.0', variables: { plazoPagoLineaHoras: '24', diasGarantia: '7' } },
      { slug: 'reembolsos', titulo: 'Reembolsos', version: '1.0', variables: { diasGarantia: '7' } },
    ];
    const r = documentosDesactualizados(vigentes, conReglas((x) => (x.tienda.plazoPagoLineaHoras = 48)));
    expect(r).toEqual([{ slug: 'terminos', titulo: 'Términos', version: '2.0', variables: [{ nombre: 'plazoPagoLineaHoras', publicado: '24', actual: '48' }] }]);
    expect(documentosDesactualizados(vigentes, REGLAS_POR_OMISION)).toEqual([]);
    expect(documentosDesactualizados(vigentes, conReglas((x) => (x.garantia.diasServicio = 10))).map((d) => d.slug)).toEqual(['terminos', 'reembolsos']);
  });

  it('afectadosPorReglas: con las reglas de hoy y con reglas propuestas (sin repetir anticipos)', async () => {
    const { servicio } = montar();
    expect(await servicio.afectadosPorReglas(undefined, AHORA)).toEqual([]);
    const propuestas = await servicio.afectadosPorReglas({ garantia: { diasServicio: 10 } }, AHORA);
    expect(propuestas.map((d) => d.slug)).toEqual(['terminos', 'reembolsos']);
    expect(propuestas[0].variables).toEqual([{ nombre: 'diasGarantia', publicado: '7', actual: '10' }]);
    establecerReglasNegocio({ tienda: { plazoPagoLineaHoras: 36 } });
    const hoy = await servicio.afectadosPorReglas(undefined, AHORA);
    expect(hoy).toEqual([expect.objectContaining({ slug: 'terminos', variables: [{ nombre: 'plazoPagoLineaHoras', publicado: '24', actual: '36' }] })]);
  });

  it('cambiar la regla después de publicar no cambia el texto ni el hash publicados', async () => {
    const { servicio } = montar();
    const antes = await servicio.vigente('terminos', AHORA);
    establecerReglasNegocio({ garantia: { diasServicio: 30 } });
    const despues = await servicio.vigente('terminos', AHORA);
    expect(despues.html).toBe(antes.html);
    expect(despues.hash).toBe(antes.hash);
  });

  it('prepararVersion crea el borrador desde la plantilla vigente y no pisa uno que ya existe', async () => {
    const { servicio, prisma } = montar();
    const r = await servicio.prepararVersion('terminos', 'admin-1', AHORA);
    expect(r).toMatchObject({ creado: true, basadoEnVersion: '2.0' });
    expect(prisma.borradores.get('terminos').plantilla).toBe(PLANTILLA_TERMINOS);
    await servicio.guardarBorrador('terminos', `${PLANTILLA_TERMINOS}\n\nCambio mío.`, 'admin-1');
    const otra = await servicio.prepararVersion('terminos', 'admin-1', AHORA);
    expect(otra.creado).toBe(false);
    expect(prisma.borradores.get('terminos').plantilla).toContain('Cambio mío.');
    expect((await servicio.prepararVersion('anticipos', 'admin-1', AHORA)).slug).toBe('reembolsos');
  });
});

describe('Vista previa, borrador e historial', () => {
  it('la vista previa llena las variables con las reglas de hoy y calcula el hash sin guardar nada', async () => {
    const { servicio, prisma } = montar();
    establecerReglasNegocio({ garantia: { diasServicio: 12 } });
    const r = await servicio.vistaPrevia('terminos', { plantilla: PLANTILLA_TERMINOS, version: '2.1', vigenteDesde: '2026-10-20' }, AHORA);
    expect(r.errores).toEqual([]);
    expect(textoVisible(r.html)).toContain('Tienes 12 días.');
    expect(r.hash).toBe(hashTextoVisible(r.html));
    expect(r.variables).toEqual({ plazoPagoLineaHoras: '24', diasGarantia: '12' });
    expect(prisma.versionDocumentoLegal.create).not.toHaveBeenCalled();
    const mala = await servicio.vistaPrevia('terminos', { plantilla: '## A\n\n{noExiste}' }, AHORA);
    expect(mala.errores.join(' ')).toMatch(/noExiste/);
  });

  it('el borrador por omisión es la plantilla vigente; guardarlo y descartarlo', async () => {
    const { servicio } = montar();
    const inicial = await servicio.borrador('terminos', AHORA);
    expect(inicial).toMatchObject({ plantilla: PLANTILLA_TERMINOS, guardado: false, basadoEnVersion: '2.0' });
    expect(inicial.variablesDisponibles).toContainEqual({ nombre: 'diasGarantia', etiqueta: 'Días de garantía de un servicio', valor: '7' });
    expect(inicial.variablesDisponibles).toHaveLength(VARIABLES_REGLAS.length);
    await servicio.guardarBorrador('terminos', 'Nuevo', 'admin-1');
    expect(await servicio.borrador('terminos', AHORA)).toMatchObject({ plantilla: 'Nuevo', guardado: true });
    await servicio.descartarBorrador('terminos');
    expect(await servicio.borrador('terminos', AHORA)).toMatchObject({ plantilla: PLANTILLA_TERMINOS, guardado: false });
    await expect(servicio.guardarBorrador('terminos', 'x'.repeat(200_000), 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el historial muestra cada versión con motivo, fecha, quién y si pidió volver a aceptar (solo lectura)', async () => {
    const { servicio } = montar();
    await servicio.publicar('terminos', { ...PUBLICACION, plantilla: PLANTILLA_TERMINOS }, 'admin-1', AHORA);
    const h = await servicio.historial('terminos', AHORA);
    expect(h.versiones.map((v) => v.version)).toEqual(['2.1', '2.0']);
    expect(h.versiones[0]).toMatchObject({ motivo: PUBLICACION.motivo, requiereAceptacion: true, publicadoPor: { id: 'admin-1', nombre: 'Mildred' }, estado: 'programada' });
    expect(h.versiones[1]).toMatchObject({ estado: 'vigente', publicadoPor: null });
  });

  it('listar trae los 4 documentos editables con su versión vigente', async () => {
    const { servicio } = montar();
    const docs = await servicio.listar(AHORA);
    expect(docs.map((d) => d.slug)).toEqual(['terminos', 'aviso-privacidad', 'cookies', 'reembolsos']);
    expect(docs.find((d) => d.slug === 'cookies')?.vigente).toMatchObject({ version: '1.1' });
  });
});
