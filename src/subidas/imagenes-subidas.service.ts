import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { FirmaSubida, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryGaleria, crearFirmaFotoGaleria, urlPublicaGaleria, type RecursoCloudinary } from '../galeria/cloudinary-galeria';
import {
  LIMPIAR_FIRMAS_DESPUES_MS,
  MENSAJE_CLOUDINARY_SIN_RESPUESTA,
  MENSAJE_IMAGEN_NO_ESTA,
  MENSAJE_SUBIDA_NO_PROPIA,
  MENSAJE_SUBIDA_USADA,
  MENSAJE_SUBIDA_VENCIDA,
  MENSAJE_URL_A_MANO,
  USOS_CON_ILUSTRATIVA,
  VIGENCIA_FIRMA_MS,
  esPublicIdDe,
  nuevoPublicId,
  type UsoImagen,
} from './imagenes-subidas';

/** Cada hora se limpian las firmas vencidas y sin usar con más de 24 horas. */
export const INTERVALO_LIMPIEZA_FIRMAS_MS = 60 * 60 * 1000;
const LOTE_LIMPIEZA = 100;

type ClienteDb = Pick<Prisma.TransactionClient, 'firmaSubida'>;

/** Una subida propia ya comprobada: la firma por gastar y la URL pública que armó el servidor. */
export interface SubidaComprobada {
  firma: FirmaSubida;
  publicId: string;
  url: string;
}

/**
 * Subida segura de imágenes para la galería y los formularios (servicios, productos, equipo, promociones y sitio).
 * - firmar: UNA subida con el public_id que genera el servidor; la firma se guarda vigente una hora.
 * - comprobar y gastar: solo una firma propia, del mismo uso, vigente y sin usar, y con la imagen en Cloudinary.
 * - resolver: en un formulario, cada imagen es una que ya tenía (se conserva igual) o un public_id de una subida
 *   propia; cualquier otra cosa (una URL escrita a mano) es 400.
 * - destruir: nunca una imagen que use otra parte del sitio.
 */
@Injectable()
export class ImagenesSubidasService {
  private readonly logger = new Logger(ImagenesSubidasService.name);
  private limpiando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryGaleria,
  ) {}

  async firmar(usuarioId: string, uso: UsoImagen, ilustrativa = false) {
    const ahora = Date.now();
    const conIlustrativa = ilustrativa && USOS_CON_ILUSTRATIVA.includes(uso);
    const publicId = nuevoPublicId(uso, conIlustrativa);
    const firma = crearFirmaFotoGaleria(publicId, ahora);
    await this.prisma.firmaSubida.create({
      data: { uso, publicId, ilustrativa: conIlustrativa, usuarioId, venceEn: new Date(ahora + VIGENCIA_FIRMA_MS) },
    });
    return { success: true, data: firma };
  }

  /** Comprueba (sin gastarla) que `publicId` sea de una subida propia del uso, vigente y sin usar, y que exista. */
  async comprobar(usuarioId: string, uso: UsoImagen, publicId: unknown): Promise<SubidaComprobada> {
    if (!esPublicIdDe(uso, publicId)) throw new BadRequestException(MENSAJE_SUBIDA_NO_PROPIA);
    const firma = await this.prisma.firmaSubida.findUnique({ where: { publicId } });
    if (!firma || firma.usuarioId !== usuarioId || firma.uso !== uso) throw new BadRequestException(MENSAJE_SUBIDA_NO_PROPIA);
    if (firma.usadaEn) throw new BadRequestException(MENSAJE_SUBIDA_USADA);
    if (firma.venceEn.getTime() <= Date.now()) throw new BadRequestException(MENSAJE_SUBIDA_VENCIDA);
    let recurso: RecursoCloudinary | null;
    try {
      recurso = await this.cloudinary.recurso(publicId);
    } catch (e) {
      this.logger.error(`No se pudo consultar en Cloudinary la subida ${publicId}: ${e instanceof Error ? e.message : 'error'}`);
      throw new BadGatewayException(MENSAJE_CLOUDINARY_SIN_RESPUESTA);
    }
    if (!recurso) throw new BadRequestException(MENSAJE_IMAGEN_NO_ESTA);
    return { firma, publicId, url: urlPublicaGaleria(publicId, recurso) };
  }

  /** Gasta la firma (una sola vez). Dentro de la transacción de quien registra la imagen, si la hay. */
  async gastar(firmaId: number, cliente: ClienteDb = this.prisma) {
    const gastada = await cliente.firmaSubida.updateMany({
      where: { id: firmaId, usadaEn: null, venceEn: { gt: new Date() } },
      data: { usadaEn: new Date() },
    });
    if (gastada.count !== 1) throw new BadRequestException(MENSAJE_SUBIDA_USADA);
  }

  /**
   * Imágenes de un formulario: cada valor es una imagen que ya tenía (se conserva tal cual, así las anteriores se
   * siguen viendo igual) o el public_id de una subida propia del uso (se cambia por su URL y se gasta la firma).
   * Cualquier otra cosa es una URL escrita a mano: 400. Primero se comprueba todo y después se gastan las firmas.
   */
  async resolverImagenes(usuarioId: string, uso: UsoImagen, valores: unknown[], actuales: readonly string[] = []): Promise<string[]> {
    const conservadas = new Set(actuales.filter((u) => typeof u === 'string'));
    const resultado: Array<string | SubidaComprobada> = [];
    for (const crudo of valores) {
      const valor = typeof crudo === 'string' ? crudo.trim() : crudo;
      if (typeof valor === 'string' && conservadas.has(valor)) {
        resultado.push(valor);
        continue;
      }
      if (!esPublicIdDe(uso, valor)) throw new BadRequestException(MENSAJE_URL_A_MANO);
      resultado.push(await this.comprobar(usuarioId, uso, valor));
    }
    const urls: string[] = [];
    for (const r of resultado) {
      if (typeof r === 'string') {
        urls.push(r);
      } else {
        await this.gastar(r.firma.id);
        urls.push(r.url);
      }
    }
    return urls;
  }

  /** Una sola imagen (opcional): undefined no cambia, null o vacío la quita; si no, igual que resolverImagenes. */
  async resolverImagen(usuarioId: string, uso: UsoImagen, valor: string | null | undefined, actual: string | null | undefined): Promise<string | null | undefined> {
    if (valor === undefined) return undefined;
    const limpio = valor === null ? '' : String(valor).trim();
    if (!limpio) return null;
    const [url] = await this.resolverImagenes(usuarioId, uso, [limpio], actual ? [actual] : []);
    return url;
  }

  /**
   * true si alguna parte del sitio usa la imagen (su public_id aparece en la URL guardada): servicios,
   * presentaciones, equipo, configuración del sitio, promociones, cuentas y otras fotos de la galería. Si no se
   * puede revisar, se da por usada: nunca se destruye una imagen sin estar seguros.
   */
  async imagenEnUso(publicId: string, opciones: { excluirFotoGaleriaId?: number } = {}): Promise<boolean> {
    const excluir = opciones.excluirFotoGaleriaId ?? -1;
    try {
      const filas = await this.prisma.$queryRaw<{ en_uso: boolean }[]>`
        SELECT (
          EXISTS (SELECT 1 FROM "servicios" WHERE strpos("imagen"::text, ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "producto_presentaciones" WHERE strpos(array_to_string("imagenes", ' '), ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "perfiles_empleado" WHERE strpos(coalesce("foto_publica", ''), ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "configuracion_sitio" WHERE strpos("valor"::text, ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "promociones" WHERE strpos(coalesce("imagen_url", ''), ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "usuarios" WHERE strpos(coalesce("foto", ''), ${publicId}) > 0)
          OR EXISTS (SELECT 1 FROM "galeria_fotos" WHERE strpos("url", ${publicId}) > 0 AND "id" <> ${excluir})
        ) AS en_uso`;
      return filas[0]?.en_uso !== false;
    } catch (e) {
      this.logger.error(`No se pudo revisar si otra parte del sitio usa ${publicId}: ${e instanceof Error ? e.message : 'error'}`);
      return true;
    }
  }

  /**
   * Limpieza periódica: firmas vencidas y sin usar con más de 24 horas. La imagen que se haya alcanzado a subir con
   * ellas (nunca registrada) se destruye en Cloudinary solo si nadie la usa; si Cloudinary falla, la firma se queda
   * para la siguiente pasada. Devuelve cuántas firmas se borraron.
   */
  @Interval(INTERVALO_LIMPIEZA_FIRMAS_MS)
  async alIntervaloLimpieza(): Promise<void> {
    if (this.limpiando) return;
    this.limpiando = true;
    try {
      await this.limpiarFirmasVencidas();
    } catch (e) {
      this.logger.error('Falló la limpieza de firmas de subida vencidas', e);
    } finally {
      this.limpiando = false;
    }
  }

  async limpiarFirmasVencidas(ahora: Date = new Date()): Promise<number> {
    const limite = new Date(ahora.getTime() - LIMPIAR_FIRMAS_DESPUES_MS);
    const vencidas = await this.prisma.firmaSubida.findMany({
      where: { usadaEn: null, venceEn: { lt: limite } },
      select: { id: true, publicId: true },
      orderBy: { id: 'asc' },
      take: LOTE_LIMPIEZA,
    });
    let borradas = 0;
    for (const f of vencidas) {
      if (!(await this.imagenEnUso(f.publicId))) {
        try {
          await this.cloudinary.borrar(f.publicId);
        } catch (e) {
          this.logger.warn(`No se pudo borrar en Cloudinary la subida sin usar ${f.publicId}: ${e instanceof Error ? e.message : 'error'}`);
          continue;
        }
      }
      const r = await this.prisma.firmaSubida.deleteMany({ where: { id: f.id, usadaEn: null } });
      borradas += r.count;
    }
    if (borradas) this.logger.log(`Se limpiaron ${borradas} firmas de subida vencidas sin usar`);
    return borradas;
  }
}
