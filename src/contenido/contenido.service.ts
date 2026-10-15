import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImagenesSubidasService } from '../subidas/imagenes-subidas.service';
import { sanitizeInput } from '../common/utils/security.util';
import { diaEnMexico, esDiaValido, inicioDiaMexico } from '../common/utils/zona-mexico';
import {
  ActualizarPerfilPublicoDto,
  ActualizarPreguntaDto,
  ActualizarPromocionDto,
  CrearPreguntaDto,
  CrearPromocionDto,
} from './dto/contenido.dto';

/** Admin > Contenido usa el mismo permiso que la configuración del sitio (solo admin, por '*'). */
export const PERMISO_CONTENIDO = 'configuracion:editar';

const ORDEN = [{ orden: 'asc' as const }, { id: 'asc' as const }];
const ORDEN_EQUIPO = [{ ordenPublico: 'asc' as const }, { id: 'asc' as const }];
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Ruta interna: empieza con una sola "/" (nada de "//otro.sitio"), sin espacios ni barras invertidas. */
const REGEX_ENLACE = /^\/(?![/\\])[^\s\\]*$/;

type Promocion = {
  id: number;
  titulo: string;
  descripcion: string;
  imagenUrl: string | null;
  enlace: string | null;
  vigenteDesde: Date | null;
  vigenteHasta: Date | null;
  activa: boolean;
  destacada: boolean;
  orden: number;
};

type Perfil = {
  id: number;
  puesto: string;
  activo: boolean;
  mostrarEnSitio: boolean;
  fotoPublica: string | null;
  bioPublica: string | null;
  ordenPublico: number;
  usuario: { nombre: string; activo: boolean } | null;
};

/** Texto obligatorio recortado entre 1 y `max` caracteres. */
function textoObligatorio(valor: unknown, etiqueta: string, max: number): string {
  const texto = typeof valor === 'string' ? sanitizeInput(valor) : '';
  if (!texto) throw new BadRequestException(`${etiqueta} es obligatori${etiqueta.startsWith('La') ? 'a' : 'o'}.`);
  if (texto.length > max) throw new BadRequestException(`${etiqueta} debe tener como máximo ${max} caracteres.`);
  return texto;
}

/** Imagen opcional de la cuenta propia de Cloudinary: null o vacío la quitan. */
function diaOpcional(valor: string | null | undefined, etiqueta: string): string | null | undefined {
  if (valor === undefined) return undefined;
  const limpio = valor === null ? '' : valor.trim();
  if (!limpio) return null;
  if (!REGEX_DIA.test(limpio) || !esDiaValido(limpio)) throw new BadRequestException(`${etiqueta} no es una fecha válida (AAAA-MM-DD).`);
  return limpio;
}

const comoDia = (fecha: Date | null) => (fecha ? diaEnMexico(fecha) : null);

/**
 * Contenido público administrable: promociones, preguntas frecuentes y la sección de equipo. Lo público solo lleva lo
 * que el sitio muestra; del equipo, nombre, puesto, foto y presentación (nada de contacto ni datos laborales).
 */
@Injectable()
export class ContenidoService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly subidas?: ImagenesSubidasService,
  ) {}

  /**
   * Imagen de una promoción o foto del equipo: la que ya tenía (se conserva igual) o una subida propia de su carpeta
   * (promociones/ o equipo/) con el botón "Subir foto". Una URL escrita a mano es 400.
   */
  private async imagenSubida(usuarioId: string, uso: 'promociones' | 'equipo', valor: string | null | undefined, actual: string | null): Promise<string | null | undefined> {
    if (valor === undefined) return undefined;
    const limpio = valor === null ? '' : valor.trim();
    if (!limpio) return null;
    if (limpio === actual) return actual;
    if (!this.subidas) throw new ServiceUnavailableException('La subida de imágenes no está disponible por ahora.');
    return this.subidas.resolverImagen(usuarioId, uso, limpio, actual);
  }

  // ---------------------------------------------------------------- Promociones

  /** GET /api/contenido/promociones: activas y vigentes hoy en hora de México (fechas de día completo). */
  async promocionesPublicas(ahora: Date = new Date()) {
    const inicioHoy = inicioDiaMexico(diaEnMexico(ahora));
    const filas = (await this.prisma.promocion.findMany({
      where: {
        activa: true,
        AND: [
          { OR: [{ vigenteDesde: null }, { vigenteDesde: { lte: ahora } }] },
          { OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: inicioHoy } }] },
        ],
      },
      orderBy: ORDEN,
    })) as Promocion[];
    return {
      success: true,
      data: filas.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        descripcion: p.descripcion,
        imagenUrl: p.imagenUrl,
        enlace: p.enlace,
        vigenteDesde: comoDia(p.vigenteDesde),
        vigenteHasta: comoDia(p.vigenteHasta),
        destacada: p.destacada,
      })),
    };
  }

  async listarPromociones() {
    const filas = (await this.prisma.promocion.findMany({ orderBy: ORDEN })) as Promocion[];
    return { success: true, data: filas.map((p) => this.promocionAdmin(p)) };
  }

  async crearPromocion(dto: CrearPromocionDto, usuarioId = '') {
    const datos = this.datosPromocion(dto, null);
    const imagenUrl = await this.imagenSubida(usuarioId, 'promociones', dto.imagenUrl, null);
    if (imagenUrl !== undefined) datos.imagenUrl = imagenUrl;
    const fila = (await this.prisma.promocion.create({
      data: {
        titulo: datos.titulo as string,
        descripcion: datos.descripcion as string,
        ...datos,
      },
    })) as Promocion;
    return { success: true, data: this.promocionAdmin(fila) };
  }

  async actualizarPromocion(id: number, dto: ActualizarPromocionDto, usuarioId = '') {
    const actual = (await this.prisma.promocion.findUnique({ where: { id } })) as Promocion | null;
    if (!actual) throw new NotFoundException('La promoción no existe.');
    const datos = this.datosPromocion(dto, actual);
    const imagenUrl = await this.imagenSubida(usuarioId, 'promociones', dto.imagenUrl, actual.imagenUrl);
    if (imagenUrl !== undefined) datos.imagenUrl = imagenUrl;
    const fila = (await this.prisma.promocion.update({ where: { id }, data: datos })) as Promocion;
    return { success: true, data: this.promocionAdmin(fila) };
  }

  async eliminarPromocion(id: number) {
    if (!(await this.prisma.promocion.findUnique({ where: { id } }))) throw new NotFoundException('La promoción no existe.');
    await this.prisma.promocion.delete({ where: { id } });
    return { success: true };
  }

  async ordenarPromociones(ids: number[]) {
    await this.validarIds(ids, (where) => this.prisma.promocion.count({ where }));
    await this.prisma.$transaction(ids.map((id, orden) => this.prisma.promocion.update({ where: { id }, data: { orden } })));
    return { success: true };
  }

  private datosPromocion(dto: ActualizarPromocionDto, actual: Promocion | null): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (dto.titulo !== undefined || !actual) data.titulo = textoObligatorio(dto.titulo, 'El título', 120);
    if (dto.descripcion !== undefined || !actual) data.descripcion = textoObligatorio(dto.descripcion, 'La descripción', 1000);
    if (dto.enlace !== undefined) {
      const enlace = (dto.enlace ?? '').trim();
      if (enlace && !REGEX_ENLACE.test(enlace)) {
        throw new BadRequestException('El enlace debe ser una ruta interna del sitio que empiece con "/" (por ejemplo /cliente/servicios-citas).');
      }
      data.enlace = enlace || null;
    }
    const desde = diaOpcional(dto.vigenteDesde, 'La fecha de inicio');
    const hasta = diaOpcional(dto.vigenteHasta, 'La fecha de fin');
    const desdeFinal = desde !== undefined ? desde : comoDia(actual?.vigenteDesde ?? null);
    const hastaFinal = hasta !== undefined ? hasta : comoDia(actual?.vigenteHasta ?? null);
    if (desdeFinal && hastaFinal && desdeFinal > hastaFinal) {
      throw new BadRequestException('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
    }
    if (desde !== undefined) data.vigenteDesde = desde ? inicioDiaMexico(desde) : null;
    if (hasta !== undefined) data.vigenteHasta = hasta ? inicioDiaMexico(hasta) : null;
    if (dto.activa !== undefined) data.activa = dto.activa;
    if (dto.destacada !== undefined) data.destacada = dto.destacada;
    if (dto.orden !== undefined) data.orden = dto.orden;
    return data;
  }

  private promocionAdmin(p: Promocion) {
    return {
      id: p.id,
      titulo: p.titulo,
      descripcion: p.descripcion,
      imagenUrl: p.imagenUrl,
      enlace: p.enlace,
      vigenteDesde: comoDia(p.vigenteDesde),
      vigenteHasta: comoDia(p.vigenteHasta),
      activa: p.activa,
      destacada: p.destacada,
      orden: p.orden,
    };
  }

  // ---------------------------------------------------------------- Preguntas frecuentes

  /** GET /api/contenido/preguntas-frecuentes: visibles, ordenadas. */
  async preguntasPublicas() {
    const filas = await this.prisma.preguntaFrecuente.findMany({ where: { visible: true }, orderBy: ORDEN });
    return { success: true, data: filas.map((p) => ({ id: p.id, pregunta: p.pregunta, respuesta: p.respuesta })) };
  }

  async listarPreguntas() {
    const filas = await this.prisma.preguntaFrecuente.findMany({ orderBy: ORDEN });
    return { success: true, data: filas.map((p) => this.preguntaAdmin(p)) };
  }

  async crearPregunta(dto: CrearPreguntaDto) {
    const fila = await this.prisma.preguntaFrecuente.create({
      data: {
        pregunta: textoObligatorio(dto.pregunta, 'La pregunta', 200),
        respuesta: textoObligatorio(dto.respuesta, 'La respuesta', 2000),
        orden: dto.orden ?? 0,
        visible: dto.visible ?? true,
      },
    });
    return { success: true, data: this.preguntaAdmin(fila) };
  }

  async actualizarPregunta(id: number, dto: ActualizarPreguntaDto) {
    if (!(await this.prisma.preguntaFrecuente.findUnique({ where: { id } }))) throw new NotFoundException('La pregunta no existe.');
    const data: Record<string, unknown> = {};
    if (dto.pregunta !== undefined) data.pregunta = textoObligatorio(dto.pregunta, 'La pregunta', 200);
    if (dto.respuesta !== undefined) data.respuesta = textoObligatorio(dto.respuesta, 'La respuesta', 2000);
    if (dto.orden !== undefined) data.orden = dto.orden;
    if (dto.visible !== undefined) data.visible = dto.visible;
    const fila = await this.prisma.preguntaFrecuente.update({ where: { id }, data });
    return { success: true, data: this.preguntaAdmin(fila) };
  }

  async eliminarPregunta(id: number) {
    if (!(await this.prisma.preguntaFrecuente.findUnique({ where: { id } }))) throw new NotFoundException('La pregunta no existe.');
    await this.prisma.preguntaFrecuente.delete({ where: { id } });
    return { success: true };
  }

  async ordenarPreguntas(ids: number[]) {
    await this.validarIds(ids, (where) => this.prisma.preguntaFrecuente.count({ where }));
    await this.prisma.$transaction(ids.map((id, orden) => this.prisma.preguntaFrecuente.update({ where: { id }, data: { orden } })));
    return { success: true };
  }

  private preguntaAdmin(p: { id: number; pregunta: string; respuesta: string; orden: number; visible: boolean }) {
    return { id: p.id, pregunta: p.pregunta, respuesta: p.respuesta, orden: p.orden, visible: p.visible };
  }

  // ---------------------------------------------------------------- Equipo

  /** GET /api/contenido/equipo: perfiles marcados para el sitio, activos y con cuenta activa. */
  async equipoPublico() {
    const perfiles = (await this.prisma.perfilEmpleado.findMany({
      where: { mostrarEnSitio: true, activo: true, usuario: { is: { activo: true } } },
      orderBy: ORDEN_EQUIPO,
      select: { id: true, puesto: true, fotoPublica: true, bioPublica: true, ordenPublico: true, usuario: { select: { nombre: true } } },
    })) as unknown as Array<{ puesto: string; fotoPublica: string | null; bioPublica: string | null; usuario: { nombre: string } | null }>;
    return {
      success: true,
      data: perfiles.map((p) => ({ nombre: p.usuario?.nombre ?? '', puesto: p.puesto, foto: p.fotoPublica, bio: p.bioPublica })),
    };
  }

  /** Admin: perfiles de empleado activos con lo que se publica de cada uno. */
  async listarEquipo() {
    const perfiles = (await this.prisma.perfilEmpleado.findMany({
      where: { activo: true },
      orderBy: ORDEN_EQUIPO,
      select: {
        id: true,
        puesto: true,
        activo: true,
        mostrarEnSitio: true,
        fotoPublica: true,
        bioPublica: true,
        ordenPublico: true,
        usuario: { select: { nombre: true, activo: true } },
      },
    })) as unknown as Perfil[];
    return { success: true, data: perfiles.map((p) => this.perfilAdmin(p)) };
  }

  async actualizarPerfilPublico(id: number, dto: ActualizarPerfilPublicoDto, usuarioId = '') {
    const perfil = (await this.prisma.perfilEmpleado.findUnique({ where: { id } })) as { activo: boolean; fotoPublica?: string | null } | null;
    if (!perfil || !perfil.activo) throw new NotFoundException('El perfil no existe o no está activo.');
    const data: Record<string, unknown> = {};
    if (dto.mostrarEnSitio !== undefined) data.mostrarEnSitio = dto.mostrarEnSitio;
    const foto = await this.imagenSubida(usuarioId, 'equipo', dto.fotoPublica, perfil.fotoPublica ?? null);
    if (foto !== undefined) data.fotoPublica = foto;
    if (dto.bioPublica !== undefined) {
      const bio = dto.bioPublica === null ? '' : sanitizeInput(dto.bioPublica);
      if (bio.length > 600) throw new BadRequestException('La presentación debe tener como máximo 600 caracteres.');
      data.bioPublica = bio || null;
    }
    if (dto.ordenPublico !== undefined) data.ordenPublico = dto.ordenPublico;
    const actualizado = (await this.prisma.perfilEmpleado.update({
      where: { id },
      data,
      select: {
        id: true,
        puesto: true,
        activo: true,
        mostrarEnSitio: true,
        fotoPublica: true,
        bioPublica: true,
        ordenPublico: true,
        usuario: { select: { nombre: true, activo: true } },
      },
    })) as unknown as Perfil;
    return { success: true, data: this.perfilAdmin(actualizado) };
  }

  async ordenarEquipo(ids: number[]) {
    await this.validarIds(ids, (where) => this.prisma.perfilEmpleado.count({ where: { ...where, activo: true } }));
    await this.prisma.$transaction(ids.map((id, ordenPublico) => this.prisma.perfilEmpleado.update({ where: { id }, data: { ordenPublico } })));
    return { success: true };
  }

  private perfilAdmin(p: Perfil) {
    return {
      id: p.id,
      nombre: p.usuario?.nombre ?? '',
      puesto: p.puesto,
      usuarioActivo: p.usuario?.activo ?? false,
      mostrarEnSitio: p.mostrarEnSitio,
      fotoPublica: p.fotoPublica,
      bioPublica: p.bioPublica,
      ordenPublico: p.ordenPublico,
    };
  }

  // ---------------------------------------------------------------- Común

  private async validarIds(ids: number[], contar: (where: { id: { in: number[] } }) => Promise<number>) {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('La lista tiene elementos repetidos.');
    if ((await contar({ id: { in: ids } })) !== ids.length) {
      throw new BadRequestException('Algún elemento de la lista ya no existe. Recarga la página.');
    }
  }
}
