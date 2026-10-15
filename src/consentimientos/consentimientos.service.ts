import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { neutralizarFormulaCsv } from '../db/db.constants';
import { diaEnMexico } from '../common/utils/zona-mexico';
import { sanitizeInput } from '../common/utils/security.util';
import {
  CAMPOS_SALUD_EN_NULL,
  DOCUMENTO_DE_TIPO,
  DOCUMENTOS_OBLIGATORIOS,
  RUTA_DE_FORMULARIO,
  TIPOS_CON_DOCUMENTO_OBLIGATORIO,
} from './consentimientos.constants';
import {
  ContextoPeticion,
  DocumentoAceptado,
  documentoVigente,
  filaConsentimiento,
  serializarConsentimiento,
  validarDocumento,
  versionVigente,
} from './documentos-legales';
import { ItemConsentimientoDto, RegistrarConsentimientosDto } from './dto/registrar-consentimientos.dto';
import { TX_HOLGADA } from '../pos/salidas-caja';
import { ocultarFotosDeTitular } from '../galeria/ocultar-fotos';

/** Columnas del CSV de evidencia: todas las de la tabla, con su nombre en la base. */
const COLUMNAS_CSV: ReadonlyArray<[string, string]> = [
  ['id', 'id'],
  ['usuario_id', 'usuarioId'],
  ['visitante_id', 'visitanteId'],
  ['tipo', 'tipo'],
  ['documento_slug', 'documentoSlug'],
  ['documento_version', 'documentoVersion'],
  ['documento_hash', 'documentoHash'],
  ['accion', 'accion'],
  ['creado_en', 'creadoEn'],
  ['ip', 'ip'],
  ['user_agent', 'userAgent'],
  ['formulario', 'formulario'],
  ['ruta_origen', 'rutaOrigen'],
  ['metodo', 'metodo'],
  ['registrado_por_id', 'registradoPorId'],
];

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

function aEntero(valor: string | undefined, porDefecto: number, minimo: number, maximo: number): number {
  const n = Number.parseInt(valor ?? '', 10);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

function celdaCsv(valor: unknown): string {
  const texto = valor == null ? '' : valor instanceof Date ? valor.toISOString() : String(valor);
  const seguro = neutralizarFormulaCsv(texto);
  return /[",\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/**
 * Consentimientos (tabla de SOLO INSERCIÓN). Este servicio solo crea y lee: no tiene métodos para modificar ni
 * borrar filas. Revocar es insertar otra fila con accion "revocado"; lo vigente es la fila más reciente.
 */
@Injectable()
export class ConsentimientosService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /consentimientos */
  async registrar(dto: RegistrarConsentimientosDto, titular: { usuarioId: string | null }, contexto: ContextoPeticion) {
    const usuarioId = titular.usuarioId ?? null;
    const visitanteId = dto.visitanteId ?? null;
    if (!usuarioId && !visitanteId) {
      throw new BadRequestException('Sin sesión iniciada envía visitanteId para registrar el consentimiento.');
    }

    // Todo se valida antes de insertar: si un elemento no es válido no se guarda ninguno.
    const documentos: Array<DocumentoAceptado | null> = [];
    for (const item of dto.items) documentos.push(await this.documentoDelItem(item));

    // La ruta que manda la web; sin ella, la conocida del formulario (perfil: "/perfil"); si no, null.
    const rutaOrigen = (dto.rutaOrigen ? sanitizeInput(dto.rutaOrigen) : '') || RUTA_DE_FORMULARIO[dto.formulario] || null;
    const filas = dto.items.map((item, i) =>
      filaConsentimiento({
        usuarioId,
        visitanteId,
        tipo: item.tipo,
        accion: item.accion,
        documento: documentos[i],
        formulario: dto.formulario,
        rutaOrigen,
        contexto,
      }),
    );

    const creadas = await this.prisma.$transaction(async (tx) => {
      const resultado: any[] = [];
      for (const data of filas) resultado.push(await tx.consentimiento.create({ data }));
      const cambios = usuarioId ? this.efectosEnLaCuenta(dto.items) : {};
      if (usuarioId && Object.keys(cambios).length > 0) {
        await tx.usuario.update({ where: { id: usuarioId }, data: cambios });
      }
      // Revocó la autorización de fotos del resultado: sus fotos dejan de verse en la galería.
      if (usuarioId && this.revocaFotos(dto.items)) await ocultarFotosDeTitular(tx, usuarioId);
      return resultado;
    }, TX_HOLGADA);

    return { success: true, data: creadas.map(serializarConsentimiento) };
  }

  /** GET /consentimientos/mios: el historial de la usuaria, lo más reciente primero. */
  async mios(usuarioId: string) {
    const filas = await this.prisma.consentimiento.findMany({
      where: { usuarioId },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
    return { success: true, data: filas.map(serializarConsentimiento) };
  }

  /**
   * GET /consentimientos/pendientes: documentos obligatorios cuya versión vigente la usuaria no tiene aceptada
   * (sin fila, con una versión anterior o revocada). A las cuentas anteriores sin registros les salen todos: no se
   * inventan consentimientos pasados.
   */
  async pendientes(usuarioId: string, ahora: Date = new Date()) {
    const pendientes: Array<{
      tipo: string;
      documentoSlug: string;
      version: string;
      hash: string;
      vigenteDesde: string;
      versionAceptada: string | null;
    }> = [];
    for (const { tipo, slug } of DOCUMENTOS_OBLIGATORIOS) {
      const vigente = await versionVigente(this.prisma, slug, ahora);
      if (!vigente) continue;
      // Lo que registró el personal (alta desde el panel) es evidencia, no la aceptación de la persona: se le pide igual.
      const ultima = await this.prisma.consentimiento.findFirst({
        where: { usuarioId, tipo, registradoPorId: null },
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      });
      const aceptada = ultima?.accion === 'aceptado';
      if (aceptada && ultima?.documentoVersion === vigente.version && ultima?.documentoHash === vigente.hashTexto) continue;
      pendientes.push({
        tipo,
        documentoSlug: slug,
        version: vigente.version,
        hash: vigente.hashTexto,
        vigenteDesde: vigente.vigenteDesde.toISOString().slice(0, 10),
        versionAceptada: aceptada ? (ultima?.documentoVersion ?? null) : null,
      });
    }
    return { success: true, data: pendientes };
  }

  /** GET /consentimientos/admin: búsqueda por nombre, correo o id de la persona (o id de visitante), paginada. */
  async listarAdmin(filtros: { q?: string; page?: string; limit?: string }) {
    const q = filtros.q?.trim();
    const page = aEntero(filtros.page, 1, 1, 1_000_000);
    const limit = aEntero(filtros.limit, LIMITE_POR_DEFECTO, 1, LIMITE_MAXIMO);
    const where = q
      ? {
          OR: [
            { usuarioId: q },
            { visitanteId: q },
            { usuario: { is: { nombre: { contains: q, mode: 'insensitive' as const } } } },
            { usuario: { is: { email: { contains: q, mode: 'insensitive' as const } } } },
          ],
        }
      : {};
    const [filas, total] = await Promise.all([
      this.prisma.consentimiento.findMany({
        where,
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { usuario: { select: { id: true, nombre: true, email: true, rol: true } } },
      }),
      this.prisma.consentimiento.count({ where }),
    ]);
    return {
      success: true,
      data: filas.map(serializarConsentimiento),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** GET /consentimientos/admin/export: CSV con todas las columnas (de una persona o de todas). */
  async exportarCsv(filtros: { usuarioId?: string }) {
    const usuarioId = filtros.usuarioId?.trim() || undefined;
    const filas = await this.prisma.consentimiento.findMany({
      where: usuarioId ? { usuarioId } : {},
      orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
    });
    const lineas = [
      COLUMNAS_CSV.map(([columna]) => columna).join(','),
      ...filas.map((fila: Record<string, unknown>) => COLUMNAS_CSV.map(([, campo]) => celdaCsv(fila[campo])).join(',')),
    ];
    const sufijo = usuarioId ? usuarioId.replace(/[^A-Za-z0-9_-]/g, '') || 'usuario' : 'todos';
    return { contenido: `${lineas.join('\n')}\n`, nombreArchivo: `consentimientos-${sufijo}-${diaEnMexico()}.csv` };
  }

  /**
   * Documento del elemento, siempre el que corresponde a su tipo (DOCUMENTO_DE_TIPO) y completo: slug, versión
   * y hash. Si viene, se valida contra versiones_documentos_legales. Si no viene: aceptar un documento
   * (términos, aviso, cookies, reembolsos, anticipos) es 400 y revocarlo queda sin documento; los demás tipos
   * (términos de venta, promociones, datos de salud, fotos) se ligan a la versión vigente de su documento.
   */
  private async documentoDelItem(item: ItemConsentimientoDto): Promise<DocumentoAceptado | null> {
    const slugDelTipo = DOCUMENTO_DE_TIPO[item.tipo];
    const traeAlgo = !!(item.documentoSlug || item.version || item.hash);
    if (!traeAlgo) {
      if (!TIPOS_CON_DOCUMENTO_OBLIGATORIO.has(item.tipo)) return documentoVigente(this.prisma, slugDelTipo);
      if (item.accion === 'aceptado') {
        throw new BadRequestException(`Para aceptar "${item.tipo}" envía documentoSlug, version y hash del documento.`);
      }
      return null;
    }
    if (!item.documentoSlug || !item.version || !item.hash) {
      throw new BadRequestException('El documento debe llevar documentoSlug, version y hash.');
    }
    if (item.documentoSlug !== slugDelTipo) {
      throw new BadRequestException(`El consentimiento "${item.tipo}" corresponde al documento "${slugDelTipo}".`);
    }
    const documento = { slug: item.documentoSlug, version: item.version, hash: item.hash };
    await validarDocumento(this.prisma, documento);
    return documento;
  }

  /** true si el último elemento de fotos_resultado del lote es una revocación. */
  private revocaFotos(items: ItemConsentimientoDto[]): boolean {
    const fotos = items.filter((item) => item.tipo === 'fotos_resultado');
    return fotos.length > 0 && fotos[fotos.length - 1].accion === 'revocado';
  }

  /** Efecto en la cuenta del último elemento de cada tipo: promociones (en ambos sentidos) y revocar datos de salud. */
  private efectosEnLaCuenta(items: ItemConsentimientoDto[]): Record<string, unknown> {
    const cambios: Record<string, unknown> = {};
    for (const item of items) {
      if (item.tipo === 'promociones') cambios.recibePromociones = item.accion === 'aceptado';
      if (item.tipo === 'datos_salud' && item.accion === 'revocado') Object.assign(cambios, CAMPOS_SALUD_EN_NULL);
    }
    return cambios;
  }
}
