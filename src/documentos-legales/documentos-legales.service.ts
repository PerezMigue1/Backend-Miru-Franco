import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { diaEnMexico, esDiaValido } from '../common/utils/zona-mexico';
import { TX_HOLGADA } from '../pos/salidas-caja';
import { SlugDocumento } from '../consentimientos/consentimientos.constants';
import { reglasNegocio, ReglasNegocio, validarReglas, VARIABLES_REGLAS, variablesDeReglas } from '../configuracion-sitio/reglas-negocio';
import {
  DOCUMENTOS_EDITABLES,
  DocumentoEditable,
  documentoEditableDe,
  esSlugDocumento,
  ETIQUETAS_VARIABLES,
  MAX_MOTIVO,
  MAX_PLANTILLA,
  MIN_MOTIVO,
  RUTA_DOCUMENTO,
  TITULO_DOCUMENTO,
  VERSION_VALIDA,
} from './documentos-legales.constants';
import { armarDocumento, cuerpoAMarcado, cuerpoDeDocumento } from './formato-documento';
import { hashTextoVisible } from './html-seguro';
import { llenarVariables, valoresUsados, VariableDesactualizada, variablesDesactualizadas, variablesDesconocidas } from './variables-documento';

/** Lo que manda el panel al publicar. */
export interface DatosPublicacion {
  plantilla: string;
  version: string;
  vigenteDesde: string;
  motivo: string;
  /** Por omisión true: cambio importante que se pide volver a aceptar. */
  requiereAceptacion?: boolean;
}

interface FilaVersion {
  id: number;
  slug: string;
  version: string;
  hashTexto: string;
  vigenteDesde: Date;
  creadoEn: Date;
  contenido: {
    html: string;
    plantilla: string;
    variables: unknown;
    requiereAceptacion: boolean;
    motivo: string;
    publicadoPorId: string | null;
    creadoEn: Date;
  } | null;
}

/** Documento vigente con las variables que se congelaron al publicarlo. */
export interface DocumentoConVariables {
  slug: string;
  titulo: string;
  version: string;
  variables: unknown;
}

export interface DocumentoDesactualizado {
  slug: string;
  titulo: string;
  version: string;
  variables: VariableDesactualizada[];
}

/**
 * Documentos vigentes que quedarían desactualizados con estas reglas: los que usan una variable cuyo valor publicado
 * ya no es el de la regla. Función pura: el panel de Reglas la usa (POST afectados-por-reglas) para avisar antes de
 * guardar y el de Documentos legales para ofrecer "Preparar nueva versión".
 */
export function documentosDesactualizados(vigentes: DocumentoConVariables[], reglas: ReglasNegocio): DocumentoDesactualizado[] {
  const actuales = variablesDeReglas(reglas);
  return vigentes
    .map((d) => ({ slug: d.slug, titulo: d.titulo, version: d.version, variables: variablesDesactualizadas(d.variables, actuales) }))
    .filter((d) => d.variables.length > 0);
}

const fecha = (d: Date) => d.toISOString().slice(0, 10);

/** "2.10" > "2.9": compara mayor y menor como números. */
function compararVersiones(a: string, b: string): number {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

const esConflictoUnico = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

/**
 * Documentos legales en la base (Admin > Documentos legales y las páginas públicas).
 * - Una versión publicada nunca se edita: versiones_documentos_legales y contenidos_documentos_legales son de solo
 *   inserción. Publicar es insertar la versión y su texto en una transacción.
 * - El hash lo calcula el backend con la regla de la web (html-seguro.ts) sobre el html ya limpio.
 * - Las variables de reglas se llenan al publicar y su valor queda guardado con la versión.
 */
@Injectable()
export class DocumentosLegalesService {
  constructor(private readonly prisma: PrismaService) {}

  private hoy(ahora: Date): Date {
    return new Date(`${diaEnMexico(ahora)}T00:00:00.000Z`);
  }

  private editable(slug: string): DocumentoEditable {
    const doc = documentoEditableDe(slug);
    if (!doc) throw new NotFoundException(`"${slug}" no es un documento legal.`);
    return doc;
  }

  /** Versiones de los slugs, de la más antigua a la más reciente (como versionVigente: vigente_desde y luego id). */
  private async versiones(slugs: string[]): Promise<FilaVersion[]> {
    return this.prisma.versionDocumentoLegal.findMany({
      where: { slug: { in: slugs } },
      orderBy: [{ vigenteDesde: 'asc' }, { id: 'asc' }],
      include: {
        contenido: {
          select: { html: true, plantilla: true, variables: true, requiereAceptacion: true, motivo: true, publicadoPorId: true, creadoEn: true },
        },
      },
    }) as unknown as Promise<FilaVersion[]>;
  }

  /** La vigente de un slug: la más reciente con vigente_desde <= hoy (día de México). */
  private vigenteDe(filas: FilaVersion[], slug: string, ahora: Date): FilaVersion | null {
    const hoy = this.hoy(ahora);
    const del = filas.filter((f) => f.slug === slug && f.vigenteDesde <= hoy);
    return del.length ? del[del.length - 1] : null;
  }

  // ---------------------------------------------------------------- Público

  /** GET /documentos-legales/vigentes: versión y hash vigentes de los 5 documentos (para las casillas). */
  async vigentes(ahora: Date = new Date()) {
    const slugs = Object.keys(TITULO_DOCUMENTO) as SlugDocumento[];
    const filas = await this.versiones(slugs);
    return slugs
      .map((slug) => {
        const v = this.vigenteDe(filas, slug, ahora);
        return v
          ? {
              slug,
              titulo: TITULO_DOCUMENTO[slug],
              ruta: RUTA_DOCUMENTO[slug],
              version: v.version,
              hash: v.hashTexto,
              vigenteDesde: fecha(v.vigenteDesde),
              requiereAceptacion: v.contenido?.requiereAceptacion ?? true,
            }
          : null;
      })
      .filter((d) => d !== null);
  }

  /** GET /documentos-legales/:slug/vigente: el texto publicado vigente (html ya limpio). Sin datos de quién publicó. */
  async vigente(slug: string, ahora: Date = new Date()) {
    if (!esSlugDocumento(slug)) throw new NotFoundException(`"${slug}" no es un documento legal.`);
    const v = this.vigenteDe(await this.versiones([slug]), slug, ahora);
    if (!v) throw new NotFoundException(`No hay una versión publicada del documento "${slug}".`);
    return {
      slug,
      titulo: TITULO_DOCUMENTO[slug],
      ruta: RUTA_DOCUMENTO[slug],
      version: v.version,
      hash: v.hashTexto,
      vigenteDesde: fecha(v.vigenteDesde),
      requiereAceptacion: v.contenido?.requiereAceptacion ?? true,
      /** null si la versión es anterior al editor y no tiene texto en la base: la web usa su respaldo. */
      html: v.contenido?.html ?? null,
    };
  }

  // ---------------------------------------------------------------- Panel

  /** GET /documentos-legales/admin: los documentos editables con su versión vigente, la programada y el borrador. */
  async listar(ahora: Date = new Date()) {
    const filas = await this.versiones(DOCUMENTOS_EDITABLES.map((d) => d.slug));
    const borradores = await this.prisma.borradorDocumentoLegal.findMany();
    const actuales = variablesDeReglas(reglasNegocio());
    const hoy = this.hoy(ahora);
    return DOCUMENTOS_EDITABLES.map((d) => {
      const vigente = this.vigenteDe(filas, d.slug, ahora);
      const programada = filas.filter((f) => f.slug === d.slug && f.vigenteDesde > hoy).pop() ?? null;
      const borrador = borradores.find((b) => b.slug === d.slug) ?? null;
      return {
        slug: d.slug,
        titulo: d.titulo,
        ruta: d.ruta,
        incluye: d.incluye ?? null,
        vigente: vigente
          ? {
              version: vigente.version,
              vigenteDesde: fecha(vigente.vigenteDesde),
              hash: vigente.hashTexto,
              requiereAceptacion: vigente.contenido?.requiereAceptacion ?? true,
              tieneTexto: !!vigente.contenido,
            }
          : null,
        programada: programada ? { version: programada.version, vigenteDesde: fecha(programada.vigenteDesde) } : null,
        borrador: borrador ? { actualizadoEn: borrador.actualizadoEn, basadoEnVersion: borrador.basadoEnVersion } : null,
        variablesDesactualizadas: vigente ? variablesDesactualizadas(vigente.contenido?.variables, actuales) : [],
      };
    });
  }

  /** GET /documentos-legales/admin/:slug/versiones: historial de solo lectura, la más reciente primero. */
  async historial(slug: string, ahora: Date = new Date()) {
    const doc = this.editable(slug);
    const filas = (await this.versiones([doc.slug])).reverse();
    const vigente = this.vigenteDe([...filas].reverse(), doc.slug, ahora);
    const ids = [...new Set(filas.map((f) => f.contenido?.publicadoPorId).filter((x): x is string => !!x))];
    const usuarios = ids.length ? await this.prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } }) : [];
    const hoy = this.hoy(ahora);
    return {
      slug: doc.slug,
      titulo: doc.titulo,
      versiones: filas.map((f) => {
        const quien = f.contenido?.publicadoPorId ?? null;
        return {
          version: f.version,
          vigenteDesde: fecha(f.vigenteDesde),
          publicadoEn: f.contenido?.creadoEn ?? f.creadoEn,
          hash: f.hashTexto,
          motivo: f.contenido?.motivo ?? null,
          requiereAceptacion: f.contenido?.requiereAceptacion ?? true,
          tieneTexto: !!f.contenido,
          estado: f === vigente ? 'vigente' : f.vigenteDesde > hoy ? 'programada' : 'anterior',
          publicadoPor: quien ? { id: quien, nombre: usuarios.find((u) => u.id === quien)?.nombre ?? 'Cuenta que ya no existe' } : null,
          variables: f.contenido?.variables ?? {},
        };
      }),
    };
  }

  /** GET /documentos-legales/admin/:slug/versiones/:version: el texto publicado de una versión (solo consulta). */
  async verVersion(slug: string, version: string) {
    const doc = this.editable(slug);
    const fila = (await this.versiones([doc.slug])).find((f) => f.version === version);
    if (!fila) throw new NotFoundException(`No existe la versión ${version} de ${doc.titulo}.`);
    return {
      slug: doc.slug,
      version: fila.version,
      vigenteDesde: fecha(fila.vigenteDesde),
      hash: fila.hashTexto,
      html: fila.contenido?.html ?? null,
      plantilla: fila.contenido?.plantilla ?? null,
      variables: fila.contenido?.variables ?? {},
      motivo: fila.contenido?.motivo ?? null,
      requiereAceptacion: fila.contenido?.requiereAceptacion ?? true,
    };
  }

  /** Plantilla de la versión vigente (o la del html, si es anterior al editor), base de un borrador nuevo. */
  private plantillaVigente(v: FilaVersion | null): string {
    if (!v?.contenido) return '';
    return v.contenido.plantilla || cuerpoAMarcado(cuerpoDeDocumento(v.contenido.html));
  }

  /** GET /documentos-legales/admin/:slug/borrador: el guardado o, si no hay, la plantilla vigente (sin guardar). */
  async borrador(slug: string, ahora: Date = new Date()) {
    const doc = this.editable(slug);
    const guardado = await this.prisma.borradorDocumentoLegal.findUnique({ where: { slug: doc.slug } });
    if (guardado) {
      return {
        slug: doc.slug,
        plantilla: guardado.plantilla,
        guardado: true,
        basadoEnVersion: guardado.basadoEnVersion,
        actualizadoEn: guardado.actualizadoEn,
        variablesDisponibles: this.variablesDisponibles(),
      };
    }
    const vigente = this.vigenteDe(await this.versiones([doc.slug]), doc.slug, ahora);
    return {
      slug: doc.slug,
      plantilla: this.plantillaVigente(vigente),
      guardado: false,
      basadoEnVersion: vigente?.version ?? null,
      actualizadoEn: null,
      variablesDisponibles: this.variablesDisponibles(),
    };
  }

  /** Variables que puede usar el texto, con su nombre legible y su valor de hoy (menú del editor y vista previa). */
  variablesDisponibles() {
    const valores = variablesDeReglas(reglasNegocio());
    return VARIABLES_REGLAS.map((nombre) => ({ nombre, etiqueta: ETIQUETAS_VARIABLES[nombre] ?? nombre, valor: valores[nombre] ?? '' }));
  }

  private validarPlantilla(plantilla: unknown): string {
    if (typeof plantilla !== 'string' || !plantilla.trim()) throw new BadRequestException('Escribe el texto del documento.');
    if (plantilla.length > MAX_PLANTILLA) throw new BadRequestException(`El documento tiene como máximo ${MAX_PLANTILLA.toLocaleString('es-MX')} caracteres.`);
    return plantilla;
  }

  /** PUT /documentos-legales/admin/:slug/borrador */
  async guardarBorrador(slug: string, plantilla: unknown, usuarioId: string | null, basadoEnVersion?: string | null) {
    const doc = this.editable(slug);
    const texto = this.validarPlantilla(plantilla);
    const fila = await this.prisma.borradorDocumentoLegal.upsert({
      where: { slug: doc.slug },
      create: { slug: doc.slug, plantilla: texto, basadoEnVersion: basadoEnVersion ?? null, actualizadoPorId: usuarioId },
      update: { plantilla: texto, actualizadoPorId: usuarioId },
    });
    return { slug: doc.slug, plantilla: fila.plantilla, guardado: true, basadoEnVersion: fila.basadoEnVersion, actualizadoEn: fila.actualizadoEn };
  }

  /** DELETE /documentos-legales/admin/:slug/borrador (el borrador es editable; las versiones no). */
  async descartarBorrador(slug: string) {
    const doc = this.editable(slug);
    const { count } = await this.prisma.borradorDocumentoLegal.deleteMany({ where: { slug: doc.slug } });
    return { slug: doc.slug, descartado: count > 0 };
  }

  /**
   * POST /documentos-legales/admin/:slug/preparar-version: borrador desde la plantilla vigente, sin publicar. Las
   * variables quedan como {nombre}: al publicar toman el valor de la regla de ese momento. Si ya hay un borrador no se
   * pisa (sus variables también toman el valor de hoy al publicar).
   */
  async prepararVersion(slug: string, usuarioId: string | null, ahora: Date = new Date()) {
    const doc = this.editable(slug);
    const existente = await this.prisma.borradorDocumentoLegal.findUnique({ where: { slug: doc.slug } });
    if (existente) return { slug: doc.slug, creado: false, basadoEnVersion: existente.basadoEnVersion };
    const vigente = this.vigenteDe(await this.versiones([doc.slug]), doc.slug, ahora);
    if (!vigente?.contenido) throw new BadRequestException(`${doc.titulo} no tiene un texto publicado del que partir.`);
    await this.prisma.borradorDocumentoLegal.create({
      data: { slug: doc.slug, plantilla: this.plantillaVigente(vigente), basadoEnVersion: vigente.version, actualizadoPorId: usuarioId },
    });
    return { slug: doc.slug, creado: true, basadoEnVersion: vigente.version };
  }

  /** Armado del documento: variables desconocidas, formato no permitido y enlaces, todo como errores. */
  private armar(doc: DocumentoEditable, plantilla: string, version: string, vigenteDesde: string) {
    const valores = variablesDeReglas(reglasNegocio());
    const desconocidas = variablesDesconocidas(plantilla, VARIABLES_REGLAS);
    const armado = armarDocumento({ tituloPagina: doc.tituloPagina, etiquetaIndice: doc.etiquetaIndice, version, vigenteDesde }, llenarVariables(plantilla, valores));
    const errores = [
      ...(desconocidas.length
        ? [`Estas variables no existen en las reglas: ${desconocidas.map((v) => `{${v}}`).join(', ')}. Usa solo las de la lista.`]
        : []),
      ...armado.errores,
    ];
    return { html: armado.html, hash: hashTextoVisible(armado.html), variables: valoresUsados(plantilla, valores), errores, desconocidas };
  }

  /** POST /documentos-legales/admin/:slug/vista-previa: el documento con las reglas de hoy, sin guardar nada. */
  async vistaPrevia(slug: string, datos: { plantilla: unknown; version?: string; vigenteDesde?: string }, ahora: Date = new Date()) {
    const doc = this.editable(slug);
    const plantilla = this.validarPlantilla(datos.plantilla);
    const vigente = this.vigenteDe(await this.versiones([doc.slug]), doc.slug, ahora);
    const version = datos.version && VERSION_VALIDA.test(datos.version) ? datos.version : (vigente?.version ?? '1.0');
    const vigenteDesde = datos.vigenteDesde && /^\d{4}-\d{2}-\d{2}$/.test(datos.vigenteDesde) && esDiaValido(datos.vigenteDesde) ? datos.vigenteDesde : diaEnMexico(ahora);
    const r = this.armar(doc, plantilla, version, vigenteDesde);
    return { slug: doc.slug, version, vigenteDesde, html: r.html, hash: r.hash, variables: r.variables, errores: r.errores };
  }

  /**
   * POST /documentos-legales/admin/:slug/publicar: inserta la versión nueva y su texto (en reembolsos, también
   * anticipos) en una transacción. Nunca modifica una versión publicada: las anteriores quedan para consulta.
   */
  async publicar(slug: string, datos: DatosPublicacion, usuarioId: string | null, ahora: Date = new Date()) {
    const doc = this.editable(slug);
    if (doc.slug !== slug) {
      throw new BadRequestException(`${TITULO_DOCUMENTO[slug as SlugDocumento] ?? slug} es parte de ${doc.titulo}: publícala desde ese documento (${doc.slug}).`);
    }
    const plantilla = this.validarPlantilla(datos.plantilla);
    const version = String(datos.version ?? '').trim();
    if (!VERSION_VALIDA.test(version)) throw new BadRequestException('La versión debe tener la forma X.Y (por ejemplo, 2.1).');
    const motivo = String(datos.motivo ?? '').trim();
    if (motivo.length < MIN_MOTIVO) throw new BadRequestException(`Escribe el motivo del cambio (al menos ${MIN_MOTIVO} caracteres).`);
    if (motivo.length > MAX_MOTIVO) throw new BadRequestException(`El motivo tiene como máximo ${MAX_MOTIVO} caracteres.`);
    const vigenteDesde = String(datos.vigenteDesde ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde) || !esDiaValido(vigenteDesde)) {
      throw new BadRequestException('La fecha de vigencia debe ser una fecha válida (AAAA-MM-DD).');
    }
    const hoy = diaEnMexico(ahora);
    if (vigenteDesde < hoy) throw new BadRequestException('La fecha de vigencia debe ser hoy o una fecha futura.');
    const requiereAceptacion = datos.requiereAceptacion !== false;

    const filas = await this.versiones(doc.slugs);
    for (const s of doc.slugs) {
      const delSlug = filas.filter((f) => f.slug === s);
      const mayor = delSlug.reduce<FilaVersion | null>((m, f) => (!m || compararVersiones(f.version, m.version) > 0 ? f : m), null);
      if (mayor && compararVersiones(version, mayor.version) <= 0) {
        throw new BadRequestException(`La versión debe ser mayor que la ${mayor.version} ya publicada de ${TITULO_DOCUMENTO[s]}.`);
      }
      const ultima = delSlug[delSlug.length - 1];
      if (ultima && vigenteDesde < fecha(ultima.vigenteDesde)) {
        throw new BadRequestException(`La fecha de vigencia no puede ser anterior a la de la versión ${ultima.version} (${fecha(ultima.vigenteDesde)}).`);
      }
    }

    const armado = this.armar(doc, plantilla, version, vigenteDesde);
    if (armado.errores.length) throw new BadRequestException(armado.errores.join(' '));

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const s of doc.slugs) {
          const fila = await tx.versionDocumentoLegal.create({
            data: { slug: s, version, hashTexto: armado.hash, vigenteDesde: new Date(`${vigenteDesde}T00:00:00.000Z`) },
          });
          await tx.contenidoDocumentoLegal.create({
            data: {
              versionId: fila.id,
              slug: s,
              version,
              html: armado.html,
              plantilla,
              variables: armado.variables,
              requiereAceptacion,
              motivo,
              publicadoPorId: usuarioId,
            },
          });
        }
        await tx.borradorDocumentoLegal.deleteMany({ where: { slug: doc.slug } });
      }, TX_HOLGADA);
    } catch (e) {
      if (esConflictoUnico(e)) throw new ConflictException(`Alguien ya publicó la versión ${version} de ${doc.titulo}. Recarga la página.`);
      throw e;
    }
    return { slug: doc.slug, version, vigenteDesde, hash: armado.hash, requiereAceptacion, variables: armado.variables };
  }

  /**
   * GET o POST /documentos-legales/admin/afectados-por-reglas: documentos vigentes cuyo texto usa una regla que ya
   * cambió (o que cambiaría con las reglas propuestas, que se completan con las de hoy).
   */
  async afectadosPorReglas(propuestas?: unknown, ahora: Date = new Date()): Promise<DocumentoDesactualizado[]> {
    const reglas = propuestas === undefined || propuestas === null ? reglasNegocio() : validarReglas(propuestas, reglasNegocio()).limpio;
    const filas = await this.versiones(DOCUMENTOS_EDITABLES.map((d) => d.slug));
    const vigentes: DocumentoConVariables[] = [];
    for (const d of DOCUMENTOS_EDITABLES) {
      const v = this.vigenteDe(filas, d.slug, ahora);
      if (v?.contenido) vigentes.push({ slug: d.slug, titulo: d.titulo, version: v.version, variables: v.contenido.variables });
    }
    return documentosDesactualizados(vigentes, reglas);
  }
}
