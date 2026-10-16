import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionSitioService } from '../configuracion-sitio/configuracion-sitio.service';
import { VARIABLES_REGLAS, variablesDeReglas } from '../configuracion-sitio/reglas-negocio';
import { CATALOGO_TEXTOS, DEFINICION_POR_CLAVE, PAGINAS_TEXTOS, VARIABLES_CONTEXTO, type DefinicionTexto } from './catalogo';
import { erroresTexto, establecerTextosSitio, plantillaTexto } from './textos-sitio.util';

const TIEMPO_REFRESCO_MS = 60_000;
const MAX_HISTORIAL = 50;

/** Etiquetas de las variables de reglas para la pantalla (qué significa cada una). */
const DESCRIPCION_REGLAS: Record<string, string> = {
  plazoAnticipoHoras: 'Horas para pagar el anticipo en línea',
  minutosAntesPagoSalon: 'Minutos antes de la cita para pagar el anticipo en el salón',
  minutosLlegadaAntes: 'Minutos que se pide llegar antes',
  toleranciaLlegadaMinutos: 'Minutos de tolerancia de llegada',
  horasAvisoCancelarReagendar: 'Horas de aviso para cancelar o reagendar',
  mesesSoloPagoEnLinea: 'Meses con pago solo en línea después de una falta',
  diasHabilesExcepcionAnticipo: 'Días hábiles de la excepción del anticipo',
  diasHabilesCancelarConReembolso: 'Días hábiles para cancelar con reembolso',
  plazoPagoLineaHoras: 'Horas para pagar un pedido en línea',
  diasPrepararApartado: 'Días para preparar un apartado',
  diaRecordatorioRecoger: 'Día del recordatorio para recoger',
  diasCancelarNoRecogido: 'Días para cancelar un apartado no recogido',
  diasRestantesRecoger: 'Días que quedan para recoger después del recordatorio',
  diasResguardo: 'Días de resguardo de un pedido pagado',
  tiempoPreparacion: 'Tiempo estimado de preparación',
  diasCambioProducto: 'Días para cambios de producto',
  diasHabilesRevocacion: 'Días hábiles para revocar una compra',
  diasGarantia: 'Días de garantía de servicios',
  plazoFactura: 'Plazo para pedir factura',
  diasHabilesArcoRespuesta: 'Días hábiles para responder una solicitud ARCO',
  diasHabilesArcoEfectividad: 'Días hábiles para hacer efectiva una solicitud ARCO',
};

export interface VariableTexto {
  nombre: string;
  descripcion: string;
  /** Valor de hoy (reglas) o un ejemplo (contexto) para la vista previa. */
  ejemplo: string;
  origen: 'regla' | 'contexto';
}

/**
 * Admin > Textos del sitio: catálogo con el valor actual, guardar con validación (largo, variables, llaves, sin HTML),
 * restaurar el original e historial de solo inserción. Los textos viven en memoria para correos y avisos
 * (textos-sitio.util) y se cargan al arrancar, cada minuto y al guardar.
 */
@Injectable()
export class TextosSitioService implements OnModuleInit {
  private readonly logger = new Logger(TextosSitioService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configuracionSitio?: ConfiguracionSitioService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refrescar();
  }

  @Interval(TIEMPO_REFRESCO_MS)
  async refrescar(): Promise<void> {
    try {
      const filas = await this.prisma.textoSitio.findMany({ select: { clave: true, valor: true } });
      establecerTextosSitio(filas);
    } catch (e) {
      // Se conservan los textos vigentes (o los de hoy si nunca se cargaron).
      this.logger.warn(`No se pudieron leer los textos del sitio (${e instanceof Error ? e.message : 'error'})`);
    }
  }

  private definicion(clave: string): DefinicionTexto {
    const def = DEFINICION_POR_CLAVE.get(clave);
    if (!def) throw new NotFoundException(`El texto "${clave}" no existe.`);
    return def;
  }

  private variables(def: DefinicionTexto): VariableTexto[] {
    const hoy = variablesDeReglas();
    return [
      ...def.contexto.map((nombre) => ({
        nombre,
        descripcion: VARIABLES_CONTEXTO[nombre]?.descripcion ?? nombre,
        ejemplo: VARIABLES_CONTEXTO[nombre]?.ejemplo ?? '',
        origen: 'contexto' as const,
      })),
      ...VARIABLES_REGLAS.map((nombre) => ({ nombre, descripcion: DESCRIPCION_REGLAS[nombre] ?? nombre, ejemplo: hoy[nombre] ?? '', origen: 'regla' as const })),
    ];
  }

  private async nombres(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unicos.length) return new Map();
    const usuarios = await this.prisma.usuario.findMany({ where: { id: { in: unicos } }, select: { id: true, nombre: true } });
    return new Map(usuarios.map((u) => [u.id, u.nombre]));
  }

  async listar() {
    const filas = await this.prisma.textoSitio.findMany();
    const porClave = new Map(filas.map((f) => [f.clave, f]));
    const nombres = await this.nombres(filas.map((f) => f.actualizadoPorId));
    return {
      paginas: PAGINAS_TEXTOS,
      data: CATALOGO_TEXTOS.map((def) => {
        const fila = porClave.get(def.clave);
        const valor = fila && erroresTexto(def, fila.valor).length === 0 ? fila.valor : def.porDefecto;
        return {
          clave: def.clave,
          pagina: def.pagina,
          descripcion: def.descripcion,
          tipo: def.tipo,
          max: def.max,
          valor,
          porDefecto: def.porDefecto,
          personalizado: valor !== def.porDefecto,
          variables: this.variables(def),
          // La fila sembrada por la migración no cuenta como cambio de la dueña.
          actualizadoEn: fila?.actualizadoPorId ? fila.actualizadoEn : null,
          actualizadoPor: fila?.actualizadoPorId ? (nombres.get(fila.actualizadoPorId) ?? null) : null,
        };
      }),
    };
  }

  /** Valida el texto para su clave. 400 con todos los errores en español. */
  validar(clave: string, valor: unknown): string {
    const def = this.definicion(clave);
    const errores = erroresTexto(def, valor);
    if (errores.length) throw new BadRequestException({ message: errores, error: 'Texto inválido' });
    return (valor as string).trim();
  }

  async guardar(clave: string, valor: unknown, usuarioId: string) {
    const limpio = this.validar(clave, valor);
    return this.escribir(clave, limpio, usuarioId, false);
  }

  async restaurar(clave: string, usuarioId: string) {
    const def = this.definicion(clave);
    return this.escribir(clave, def.porDefecto, usuarioId, true);
  }

  private async escribir(clave: string, valor: string, usuarioId: string, restaurado: boolean) {
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`textos-sitio:${clave}`}))`;
      const actual = await tx.textoSitio.findUnique({ where: { clave } });
      const anterior = actual?.valor ?? DEFINICION_POR_CLAVE.get(clave)!.porDefecto;
      if (anterior === valor && actual) return { cambio: false };
      await tx.textoSitio.upsert({
        where: { clave },
        create: { clave, valor, actualizadoPorId: usuarioId },
        update: { valor, actualizadoPorId: usuarioId },
      });
      await tx.historialTextoSitio.create({ data: { clave, valorAnterior: anterior, valorNuevo: valor, restaurado, actualizadoPorId: usuarioId } });
      return { cambio: anterior !== valor };
    });
    await this.refrescar();
    // La configuración pública (con los textos) guarda caché de un minuto: se borra para que se vea ya.
    this.configuracionSitio?.invalidarCachePublica();
    return { success: true, clave, valor: plantillaTexto(clave), restaurado, ...resultado };
  }

  async historial(clave: string) {
    this.definicion(clave);
    const filas = await this.prisma.historialTextoSitio.findMany({ where: { clave }, orderBy: { id: 'desc' }, take: MAX_HISTORIAL });
    const nombres = await this.nombres(filas.map((f) => f.actualizadoPorId));
    return {
      data: filas.map((h) => ({
        id: h.id,
        clave: h.clave,
        valorAnterior: h.valorAnterior,
        valorNuevo: h.valorNuevo,
        restaurado: h.restaurado,
        creadoEn: h.creadoEn,
        actualizadoPor: h.actualizadoPorId ? (nombres.get(h.actualizadoPorId) ?? null) : null,
      })),
    };
  }
}
