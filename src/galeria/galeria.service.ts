import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeInput } from '../common/utils/security.util';
import { CARPETA_GALERIA, CloudinaryGaleria, validarUrlGaleria } from './cloudinary-galeria';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';
import { ActualizarFotoDto, CrearFotoDto, FiltrosPanelGaleriaDto } from './dto/galeria.dto';

export const PERMISO_GALERIA_GESTIONAR = 'galeria:gestionar';
export const PERMISO_GALERIA_LECTURA = 'galeria:lectura';
/** Tipo de consentimiento que autoriza publicar fotos del resultado de una clienta. */
export const TIPO_FOTOS_RESULTADO = 'fotos_resultado';

const MAX_ALT = 200;
const MIN_BUSQUEDA = 2;
const MAX_AUTORIZACIONES = 20;

export const MENSAJE_SIN_AUTORIZACION =
  'Para publicar la foto confirma que no aparece ninguna persona identificable o elige la autorización vigente de la clienta que aparece.';
export const MENSAJE_ILUSTRATIVA_NO_SE_PUBLICA =
  'Una imagen ilustrativa no se publica en la galería: solo se muestran fotos reales de trabajos del salón.';
export const MENSAJE_FALLO_CLOUDINARY =
  'No se pudo borrar la foto en Cloudinary. La ocultamos de la galería; intenta borrarla de nuevo en unos minutos.';

const INCLUIR = {
  servicio: { select: { id: true, nombre: true, categoria: true, activo: true } },
  consentimiento: { select: { id: true, usuarioId: true, tipo: true, accion: true, creadoEn: true, usuario: { select: { nombre: true } } } },
  subidoPor: { select: { nombre: true } },
} as const;

const ORDEN = [{ orden: 'asc' as const }, { id: 'asc' as const }];

type FotoConRelaciones = {
  id: number;
  url: string;
  alt: string;
  orden: number;
  visible: boolean;
  ilustrativa: boolean;
  sinPersonasIdentificables: boolean | null;
  publicId: string | null;
  servicioId: number | null;
  consentimientoId: bigint | null;
  creadoEn: Date;
  servicio: { id: number; nombre: string; categoria: string; activo: boolean } | null;
  consentimiento: { id: bigint; usuarioId: string | null; creadoEn: Date; usuario: { nombre: string } | null } | null;
  subidoPor: { nombre: string } | null;
};

/** Estado final de la foto que decide si se puede publicar. */
interface EstadoAutorizacion {
  visible: boolean;
  ilustrativa: boolean;
  sinPersonasIdentificables: boolean | null;
  consentimientoId: bigint | null;
}

/**
 * Galería del salón. Lo público solo muestra fotos visibles, no ilustrativas y autorizadas: con la declaración de que
 * no aparece nadie identificable, con la autorización vigente de la clienta o, las anteriores sin revisar (null), tal
 * como ya estaban publicadas. Decisión: una imagen ilustrativa nunca queda visible (400 si se pide; marcarla la oculta).
 */
@Injectable()
export class GaleriaService {
  private readonly logger = new Logger(GaleriaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryGaleria,
    private readonly subidas: ImagenesSubidasService,
  ) {}

  /** GET /api/galeria: { id, url, alt, servicio } sin datos de autorización ni de quién la subió. */
  async publica() {
    const fotos = (await this.prisma.galeriaFoto.findMany({
      where: { visible: true, ilustrativa: false },
      orderBy: ORDEN,
      include: INCLUIR,
    })) as unknown as FotoConRelaciones[];
    const vigentes = await this.titularesConAutorizacionVigente(fotos);
    const data = fotos
      .filter((f) => f.sinPersonasIdentificables !== false || (f.consentimiento && vigentes.has(f.consentimiento.id)))
      .map((f) => ({
        id: f.id,
        url: f.url,
        alt: f.alt,
        servicio: f.servicio && f.servicio.activo ? { id: f.servicio.id, nombre: f.servicio.nombre, categoria: f.servicio.categoria } : null,
      }));
    return { success: true, data };
  }

  /** GET /api/galeria/panel: todas las fotos con su revisión y autorización (nombre y fecha, sin contacto). */
  async panel(filtros: FiltrosPanelGaleriaDto) {
    const where: Record<string, unknown> = {};
    if (filtros.servicioId) where.servicioId = filtros.servicioId;
    if (filtros.estado) where.visible = filtros.estado === 'visible';
    if (filtros.ilustrativa) where.ilustrativa = filtros.ilustrativa === 'true';
    const fotos = (await this.prisma.galeriaFoto.findMany({ where, orderBy: ORDEN, include: INCLUIR })) as unknown as FotoConRelaciones[];
    const vigentes = await this.titularesConAutorizacionVigente(fotos);
    return { success: true, data: fotos.map((f) => this.serializarPanel(f, vigentes)) };
  }

  /**
   * POST /api/galeria/firma: firma de UNA subida con un public_id nuevo que genera el servidor dentro de galeria/
   * (o galeria/ilustrativas/). La firma queda guardada con su vigencia de una hora; registrar la foto la gasta.
   */
  firmar(usuarioId: string, ilustrativa: boolean) {
    return this.subidas.firmar(usuarioId, 'galeria', ilustrativa);
  }

  /**
   * POST /api/galeria: solo una foto subida desde el panel. El public_id debe ser de una firma que emitió el servidor
   * para esta misma persona, vigente y sin usar, y la imagen debe existir en Cloudinary; la URL la arma el servidor.
   * La firma se gasta en la misma transacción que crea la foto.
   */
  async crear(dto: CrearFotoDto, usuarioId: string) {
    const alt = this.altValido(dto.alt);
    if (dto.servicioId) await this.servicioExistente(dto.servicioId);
    const autorizacion = this.autorizacionPedida(dto, { sinPersonasIdentificables: null, consentimientoId: null });
    // Primero la subida (firma propia del uso galeria, vigente y sin usar); después las reglas que dependen de ella.
    const { firma, publicId, url } = await this.subidas.comprobar(usuarioId, 'galeria', dto.publicId);
    if (dto.ilustrativa === false && firma.ilustrativa) throw this.errorSubidaIlustrativa();
    const estado: EstadoAutorizacion = {
      visible: dto.visible ?? false,
      ilustrativa: dto.ilustrativa === true || firma.ilustrativa,
      ...autorizacion,
    };
    await this.validarPublicacion(estado, { yaPublicadaSinRevisar: false });

    const foto = await this.prisma.$transaction(async (tx) => {
      await this.subidas.gastar(firma.id, tx);
      return tx.galeriaFoto.create({
        data: {
          url,
          publicId,
          alt,
          orden: dto.orden ?? 0,
          visible: estado.visible,
          ilustrativa: estado.ilustrativa,
          sinPersonasIdentificables: estado.sinPersonasIdentificables,
          consentimientoId: estado.consentimientoId,
          servicioId: dto.servicioId ?? null,
          subidoPorId: usuarioId,
        },
        include: INCLUIR,
      });
    });
    return { success: true, data: await this.serializarUna(foto as unknown as FotoConRelaciones) };
  }

  /** PATCH /api/galeria/:id */
  async actualizar(id: number, dto: ActualizarFotoDto) {
    const actual = await this.fotoExistente(id);
    const enIlustrativas = !!validarUrlGaleria(actual.url, process.env.CLOUDINARY_CLOUD_NAME)?.enIlustrativas;
    if (dto.ilustrativa === false && enIlustrativas) throw this.errorSubidaIlustrativa();
    if (dto.servicioId) await this.servicioExistente(dto.servicioId);
    const autorizacion = this.autorizacionPedida(dto, actual);
    const ilustrativa = dto.ilustrativa ?? actual.ilustrativa;
    let visible = dto.visible ?? actual.visible;
    // Marcarla como ilustrativa la oculta (si no pide expresamente seguir visible, que es 400 abajo).
    if (ilustrativa && dto.visible === undefined) visible = false;
    const estado: EstadoAutorizacion = { visible, ilustrativa, ...autorizacion };
    // Una foto anterior ya publicada y sin revisar sigue como estaba mientras no se toque su autorización.
    const yaPublicadaSinRevisar =
      actual.visible && actual.sinPersonasIdentificables === null && actual.consentimientoId === null &&
      estado.sinPersonasIdentificables === null && estado.consentimientoId === null;
    await this.validarPublicacion(estado, { yaPublicadaSinRevisar });

    const data: Record<string, unknown> = {
      visible: estado.visible,
      ilustrativa: estado.ilustrativa,
      sinPersonasIdentificables: estado.sinPersonasIdentificables,
      consentimientoId: estado.consentimientoId,
    };
    if (dto.alt !== undefined) data.alt = this.altValido(dto.alt);
    if (dto.servicioId !== undefined) data.servicioId = dto.servicioId ?? null;
    if (dto.orden !== undefined) data.orden = dto.orden;
    const foto = await this.prisma.galeriaFoto.update({ where: { id }, data, include: INCLUIR });
    return { success: true, data: await this.serializarUna(foto as unknown as FotoConRelaciones) };
  }

  /** PUT /api/galeria/orden: cada id toma su posición en la lista como orden. */
  async reordenar(ids: number[]) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('La lista tiene fotos repetidas.');
    const existentes = await this.prisma.galeriaFoto.count({ where: { id: { in: ids } } });
    if (existentes !== ids.length) throw new BadRequestException('Alguna foto de la lista ya no existe. Recarga la galería.');
    await this.prisma.$transaction(ids.map((id, orden) => this.prisma.galeriaFoto.update({ where: { id }, data: { orden } })));
    return { success: true };
  }

  /**
   * DELETE /api/galeria/:id: primero en Cloudinary y después la fila. Si Cloudinary falla (y no es que ya no la tenga),
   * la foto se oculta, la fila se queda para reintentar y se responde 502.
   * Solo se borra en Cloudinary lo que se subió desde el panel: public_id guardado y dentro de la carpeta galeria/.
   * Las fotos sembradas desde los servicios (sin public_id) siguen siendo la imagen del servicio y no se tocan; si
   * otra fila de la galería, un servicio, una presentación, el equipo, la configuración del sitio, una promoción o
   * una cuenta usa la imagen, tampoco: solo se quita la fila.
   */
  async eliminar(id: number) {
    const foto = await this.fotoExistente(id);
    const publicId = foto.publicId && foto.publicId.startsWith(`${CARPETA_GALERIA}/`) ? foto.publicId : null;
    const compartida = publicId ? await this.subidas.imagenEnUso(publicId, { excluirFotoGaleriaId: id }) : false;
    if (publicId && !compartida) {
      try {
        await this.cloudinary.borrar(publicId);
      } catch (e) {
        this.logger.error(`No se pudo borrar en Cloudinary la foto ${id}: ${e instanceof Error ? e.message : 'error'}`);
        await this.prisma.galeriaFoto.update({ where: { id }, data: { visible: false } });
        throw new BadGatewayException(MENSAJE_FALLO_CLOUDINARY);
      }
    }
    await this.prisma.galeriaFoto.delete({ where: { id } });
    return { success: true };
  }

  /**
   * GET /api/galeria/autorizaciones?q=: clientas cuyo último movimiento de fotos_resultado es "aceptado" y cuyo nombre
   * coincide. Solo id del consentimiento, nombre y fecha: ni correo, ni teléfono, ni id de la cuenta.
   */
  async autorizaciones(q?: string) {
    const texto = sanitizeInput(q ?? '').trim();
    if (texto.length < MIN_BUSQUEDA) return { success: true, data: [] };
    const filas = (await this.prisma.consentimiento.findMany({
      where: {
        tipo: TIPO_FOTOS_RESULTADO,
        usuarioId: { not: null },
        usuario: { is: { activo: true, nombre: { contains: texto, mode: 'insensitive' } } },
      },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      take: 500,
      select: { id: true, usuarioId: true, accion: true, creadoEn: true, usuario: { select: { nombre: true } } },
    })) as Array<{ id: bigint; usuarioId: string; accion: string; creadoEn: Date; usuario: { nombre: string } | null }>;
    const vistas = new Set<string>();
    const data: Array<{ consentimientoId: string; nombre: string; fecha: string }> = [];
    for (const fila of filas) {
      if (vistas.has(fila.usuarioId)) continue;
      vistas.add(fila.usuarioId);
      if (fila.accion !== 'aceptado' || !fila.usuario) continue;
      data.push({ consentimientoId: String(fila.id), nombre: fila.usuario.nombre, fecha: fila.creadoEn.toISOString() });
      if (data.length >= MAX_AUTORIZACIONES) break;
    }
    return { success: true, data };
  }

  // ---------------------------------------------------------------------------------------------------------------

  private altValido(alt: unknown): string {
    const texto = typeof alt === 'string' ? sanitizeInput(alt).trim() : '';
    if (!texto) throw new BadRequestException('Escribe el texto alternativo de la foto (qué se ve en ella).');
    if (texto.length > MAX_ALT) throw new BadRequestException(`El texto alternativo debe tener como máximo ${MAX_ALT} caracteres.`);
    return texto;
  }

  private async servicioExistente(id: number) {
    const servicio = await this.prisma.servicio.findUnique({ where: { id } });
    if (!servicio) throw new BadRequestException('El servicio elegido no existe.');
  }

  private async fotoExistente(id: number): Promise<FotoConRelaciones> {
    const foto = await this.prisma.galeriaFoto.findUnique({ where: { id }, include: INCLUIR });
    if (!foto) throw new NotFoundException('La foto no existe.');
    return foto as unknown as FotoConRelaciones;
  }

  private errorSubidaIlustrativa() {
    return new BadRequestException('La imagen se subió como ilustrativa y no puede presentarse como trabajo real. Súbela de nuevo como foto real.');
  }

  /**
   * Autorización que queda tras la petición. Las dos opciones se excluyen: "no aparece nadie identificable"
   * (sinPersonasIdentificables true, sin consentimiento) o "aparece una clienta" (false, con su consentimiento).
   */
  private autorizacionPedida(
    dto: { sinPersonasIdentificables?: boolean; consentimientoId?: string | null },
    actual: { sinPersonasIdentificables: boolean | null; consentimientoId: bigint | null },
  ): { sinPersonasIdentificables: boolean | null; consentimientoId: bigint | null } {
    const consentimiento = dto.consentimientoId === undefined ? undefined : dto.consentimientoId === null ? null : BigInt(dto.consentimientoId);
    if (dto.sinPersonasIdentificables === true && consentimiento) {
      throw new BadRequestException('Elige una sola opción: aparece una clienta identificable o no aparece ninguna persona identificable.');
    }
    if (dto.sinPersonasIdentificables === true) return { sinPersonasIdentificables: true, consentimientoId: null };
    if (consentimiento) return { sinPersonasIdentificables: false, consentimientoId: consentimiento };
    if (dto.sinPersonasIdentificables === false) {
      return { sinPersonasIdentificables: false, consentimientoId: consentimiento === null ? null : actual.consentimientoId };
    }
    if (consentimiento === null) {
      // Sin autorización ligada no cambia nada; si la tenía, queda "aparece una clienta" sin autorización.
      if (actual.consentimientoId === null) return { sinPersonasIdentificables: actual.sinPersonasIdentificables, consentimientoId: null };
      return { sinPersonasIdentificables: false, consentimientoId: null };
    }
    return { sinPersonasIdentificables: actual.sinPersonasIdentificables, consentimientoId: actual.consentimientoId };
  }

  /** Regla de publicación (y la de la autorización ligada aunque la foto quede oculta). */
  private async validarPublicacion(estado: EstadoAutorizacion, { yaPublicadaSinRevisar }: { yaPublicadaSinRevisar: boolean }) {
    if (estado.consentimientoId !== null) {
      const vigente = await this.autorizacionVigente(estado.consentimientoId);
      if (!vigente) {
        throw new BadRequestException('La autorización elegida no está vigente: la clienta no la otorgó o la revocó después.');
      }
    }
    if (!estado.visible) return;
    if (estado.ilustrativa) throw new BadRequestException(MENSAJE_ILUSTRATIVA_NO_SE_PUBLICA);
    if (estado.sinPersonasIdentificables === true || estado.consentimientoId !== null) return;
    if (yaPublicadaSinRevisar) return;
    throw new BadRequestException(MENSAJE_SIN_AUTORIZACION);
  }

  /**
   * Un consentimiento autoriza si es de fotos_resultado, aceptado, de una usuaria con cuenta y es su ÚLTIMO
   * movimiento de fotos_resultado (si después lo revocó, ya no vale).
   */
  private async autorizacionVigente(id: bigint): Promise<boolean> {
    const c = await this.prisma.consentimiento.findUnique({ where: { id } });
    if (!c || c.tipo !== TIPO_FOTOS_RESULTADO || c.accion !== 'aceptado' || !c.usuarioId) return false;
    const ultimo = await this.prisma.consentimiento.findFirst({
      where: { usuarioId: c.usuarioId, tipo: TIPO_FOTOS_RESULTADO },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
    return ultimo?.id === c.id;
  }

  /** Ids de los consentimientos ligados que siguen siendo el último movimiento "aceptado" de su titular. */
  private async titularesConAutorizacionVigente(fotos: FotoConRelaciones[]): Promise<Set<bigint>> {
    const titulares = [...new Set(fotos.map((f) => f.consentimiento?.usuarioId).filter((u): u is string => !!u))];
    if (titulares.length === 0) return new Set();
    const movimientos = (await this.prisma.consentimiento.findMany({
      where: { tipo: TIPO_FOTOS_RESULTADO, usuarioId: { in: titulares } },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      select: { id: true, usuarioId: true, accion: true },
    })) as Array<{ id: bigint; usuarioId: string; accion: string }>;
    const vistos = new Set<string>();
    const vigentes = new Set<bigint>();
    for (const m of movimientos) {
      if (vistos.has(m.usuarioId)) continue;
      vistos.add(m.usuarioId);
      if (m.accion === 'aceptado') vigentes.add(m.id);
    }
    return vigentes;
  }

  private async serializarUna(foto: FotoConRelaciones) {
    return this.serializarPanel(foto, await this.titularesConAutorizacionVigente([foto]));
  }

  private serializarPanel(f: FotoConRelaciones, vigentes: Set<bigint>) {
    const vigente = !!f.consentimiento && vigentes.has(f.consentimiento.id);
    const autorizada = f.sinPersonasIdentificables === true || vigente;
    return {
      id: f.id,
      url: f.url,
      alt: f.alt,
      orden: f.orden,
      visible: f.visible,
      ilustrativa: f.ilustrativa,
      sinPersonasIdentificables: f.sinPersonasIdentificables,
      revisada: f.sinPersonasIdentificables !== null || !!f.consentimiento,
      publicable: autorizada && !f.ilustrativa,
      servicio: f.servicio ? { id: f.servicio.id, nombre: f.servicio.nombre, categoria: f.servicio.categoria, activo: f.servicio.activo } : null,
      consentimiento: f.consentimiento
        ? { id: String(f.consentimiento.id), nombre: f.consentimiento.usuario?.nombre ?? '', fecha: f.consentimiento.creadoEn.toISOString(), vigente }
        : null,
      subidoPor: f.subidoPor ? { nombre: f.subidoPor.nombre } : null,
      creadoEn: f.creadoEn.toISOString(),
    };
  }
}
