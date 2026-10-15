import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { EstadoPago, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoPagoClient, PagoMercadoPago } from '../../ecommerce/mercadopago/mercadopago.client';
import {
  buscarUltimoPagoEnReferencias,
  leerReferencia,
  llaveCandadoPago,
  pagoAnteriorAlRegistro,
  referenciasDeBusqueda,
} from '../../ecommerce/mercadopago/referencia-pago';
import { METODO_PAGO_MERCADOPAGO } from '../../ecommerce/pedidos/flujo-pedido';
import { puedeEscribirCualquierCita, type Solicitante } from '../../common/utils/permisos-citas.util';
import { esCobroEnEfectivoDelSalon, registrarSalidaEfectivo, TX_HOLGADA } from '../../pos/salidas-caja';
import { EVENTO_REEMBOLSO_REALIZADO } from '../../notificaciones/eventos';
import {
  ESTADOS_CITA_VIGENTE,
  METODO_PAGO_DE_ANTICIPO,
  RUTA_RETORNO_APP,
  type MetodoAnticipoSalon,
  EVENTO_ANTICIPO_POR_DEVOLVER,
  EVENTO_ANTICIPO_REEMBOLSABLE,
  type MotivoAnticipoPorDevolver,
  centavos,
  politicaCancelacionAnticipo,
  referenciaCita,
  requiereAnticipo,
} from './anticipos.util';

const PROVEEDOR = 'mercadopago';
/** Estados de Mercado Pago de un pago que todavía puede acreditarse. */
const ESTADOS_MP_EN_PROCESO = ['pending', 'in_process', 'authorized'];
const vigente = (estado: string) => (ESTADOS_CITA_VIGENTE as readonly string[]).includes(estado);

export type ResultadoPagoCita = 'pagado' | 'ya_procesado' | 'revision' | 'no_aprobado' | 'ignorado';
export type EstadoAnticipo = 'no_requiere' | 'aprobado' | 'pendiente' | 'rechazado' | 'revision' | 'sin_pago' | 'vencido' | 'cancelada' | 'reembolsado';

/**
 * Anticipo de una cita: preferencia de Mercado Pago (solo la dueña), aplicación del pago desde el
 * webhook (idempotente), cobro en el salón, reembolso y retención. El monto sale siempre de la cita
 * (foto del anticipo del servicio al agendar), nunca de lo que mande el frontend o la notificación.
 */
@Injectable()
export class AnticiposCitasService {
  private readonly logger = new Logger(AnticiposCitasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async citaConServicio(citaId: number) {
    const cita = await this.prisma.cita.findUnique({ where: { id: citaId }, include: { servicio: { select: { id: true, nombre: true } } } });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    return cita;
  }

  async crearPreferencia(citaId: number, usuarioId: string, ahora: Date = new Date(), desdeApp = false) {
    const cita = await this.citaConServicio(citaId);
    // Solo la dueña (cualquier rol en el portal); la ajena responde 404 para no revelar que existe.
    if (cita.clienteId !== usuarioId) throw new NotFoundException('Cita no encontrada');
    if (!requiereAnticipo(cita)) throw new BadRequestException('Esta cita no pide anticipo');
    if (cita.anticipoPagadoEn) throw new ConflictException('El anticipo de esta cita ya está pagado');
    if (!vigente(cita.estado)) throw new ConflictException('Esta cita ya no está vigente');
    if (!cita.anticipoVenceEn || ahora >= cita.anticipoVenceEn) {
      throw new ConflictException('El plazo para pagar el anticipo terminó: vuelve a agendar tu cita');
    }

    const confirmacion = `${(process.env.FRONTEND_URL ?? '').replace(/\/+$/, '')}/cliente/servicios-citas/confirmacion?citaId=${cita.id}`;
    // Desde la app, Mercado Pago regresa al backend, que redirige al deep link (así no se abre la web).
    const backend = (process.env.BACKEND_URL ?? '').replace(/\/+$/, '');
    const regreso = desdeApp && backend ? `${backend}/api/${RUTA_RETORNO_APP}?citaId=${cita.id}` : confirmacion;
    const cuerpo = {
      items: [{
        id: referenciaCita(cita.id),
        title: `Anticipo: ${cita.servicio?.nombre ?? 'cita'}`,
        quantity: 1,
        unit_price: Number(cita.anticipoRequerido),
        currency_id: 'MXN',
      }],
      external_reference: referenciaCita(cita.id),
      back_urls: { success: regreso, failure: regreso, pending: regreso },
      ...(regreso.startsWith('https://') && { auto_return: 'approved' }),
      // La preferencia vence a la misma hora que el anticipo: después ya no se puede pagar.
      expires: true,
      expiration_date_from: ahora.toISOString(),
      expiration_date_to: cita.anticipoVenceEn.toISOString(),
      // Solo pagos inmediatos: efectivo en tienda o cajero se acreditan después de que la cita se libera.
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      statement_descriptor: 'MIRU FRANCO',
      ...(process.env.MP_WEBHOOK_URL ? { notification_url: process.env.MP_WEBHOOK_URL } : {}),
    };
    const preferencia = await this.mercadoPago.crearPreferencia(cuerpo, randomUUID());
    return { initPoint: preferencia.init_point };
  }

  /**
   * Aplica un pago aprobado de Mercado Pago al anticipo (llamado desde el webhook). Idempotente: la cita
   * solo se marca si sigue vigente y sin pagar (update condicional), y el pago se registra una vez
   * (llave única proveedor + referencia). Si la cita ya se liberó o canceló, o el monto no cuadra, el
   * pago queda en revisión y se avisa al personal.
   */
  async procesarPagoCita(pago: PagoMercadoPago, citaId: number): Promise<ResultadoPagoCita> {
    if (pago.status !== 'approved') return 'no_aprobado';
    const cita = await this.prisma.cita.findUnique({ where: { id: citaId } });
    if (!cita) return 'ignorado';
    // Referencia antigua sin prefijo: el id pudo ser de la otra base; un pago anterior a la cita no es suyo.
    if (leerReferencia(pago.external_reference)?.origen === 'sin_prefijo' && cita.creadoEn && pagoAnteriorAlRegistro(pago, cita.creadoEn)) {
      this.logger.warn(`El pago ${pago.id} (referencia ${pago.external_reference}) es anterior a la cita ${citaId}: es de otra base y se ignora`);
      return 'ignorado';
    }

    const montoCorrecto = pago.currency_id === 'MXN' && requiereAnticipo(cita) && centavos(pago.transaction_amount) === centavos(cita.anticipoRequerido);
    const referencia = String(pago.id);
    const pagadoEn = pago.date_approved ? new Date(pago.date_approved) : new Date();
    const fila = (estado: EstadoPago) => ({
      citaId,
      intentoNumero: 1,
      monto: pago.transaction_amount,
      moneda: pago.currency_id,
      metodo: METODO_PAGO_MERCADOPAGO,
      proveedor: PROVEEDOR,
      estado,
      referenciaExterna: referencia,
      pagadoEn,
    });

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Candado por pago: el webhook, el regreso y la barrida no lo aplican a la vez.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${llaveCandadoPago(pago.id)}))`;
      if (montoCorrecto) {
        const marcada = await tx.cita.updateMany({
          where: { id: citaId, anticipoPagadoEn: null, estado: { in: [...ESTADOS_CITA_VIGENTE] } },
          data: { anticipoPagadoEn: pagadoEn, estado: 'confirmada' },
        });
        if (marcada.count === 1) {
          await tx.pago.createMany({ data: [fila(EstadoPago.aprobado)], skipDuplicates: true });
          return 'pagado' as const;
        }
      }
      const registrado = await tx.pago.createMany({ data: [fila(EstadoPago.en_revision)], skipDuplicates: true });
      return registrado.count === 1 ? ('revision' as const) : ('ya_procesado' as const);
    });

    if (resultado === 'pagado') {
      this.eventEmitter.emit('cita.anticipo_pagado', { citaId, clienteId: cita.clienteId });
    } else if (resultado === 'revision') {
      this.logger.warn(`Pago ${referencia} del anticipo de la cita ${citaId} quedó en revisión`);
      this.eventEmitter.emit('pago.requiere_revision', {
        citaId,
        referencia,
        motivo: montoCorrecto ? 'cita_no_vigente' : 'monto_distinto',
        estadoCita: cita.estado,
      });
    }
    return resultado;
  }

  /**
   * Busca en Mercado Pago el último pago de la cita y, si está aprobado, lo aplica con procesarPagoCita
   * (misma lógica idempotente que el webhook). null si no hay pago aprobado. `ultimo` evita repetir la
   * búsqueda cuando quien llama ya la hizo. Los errores de Mercado Pago se propagan.
   */
  async aplicarPagoAprobadoDeMp(citaId: number, ultimo?: PagoMercadoPago | null): Promise<ResultadoPagoCita | null> {
    const pago = ultimo === undefined ? await buscarUltimoPagoEnReferencias(this.mercadoPago, referenciasDeBusqueda('cita', citaId)) : ultimo;
    if (pago?.status !== 'approved') return null;
    return this.procesarPagoCita(await this.mercadoPago.obtenerPago(String(pago.id)), citaId);
  }

  /**
   * Antes de pasar el anticipo a pago en el salón: qué dice Mercado Pago del pago en línea de la cita. Un pago
   * aprobado se aplica aquí (misma lógica idempotente que el webhook) y responde "pagado"; uno pendiente o en
   * proceso responde "en_proceso". Los errores de Mercado Pago se propagan.
   */
  async revisarPagoEnLinea(citaId: number): Promise<'pagado' | 'en_proceso' | 'sin_pago'> {
    const ultimo = await buscarUltimoPagoEnReferencias(this.mercadoPago, referenciasDeBusqueda('cita', citaId));
    if (ultimo?.status === 'approved') {
      await this.aplicarPagoAprobadoDeMp(citaId, ultimo);
      return 'pagado';
    }
    if (ultimo && ESTADOS_MP_EN_PROCESO.includes(ultimo.status)) return 'en_proceso';
    return 'sin_pago';
  }

  /** Estado real del anticipo para la confirmación: consulta Mercado Pago, nunca la URL de regreso. */
  async consultarEstado(citaId: number, s: Solicitante, ahora: Date = new Date()) {
    let cita = await this.citaConServicio(citaId);
    if (cita.clienteId !== s.id && !puedeEscribirCualquierCita(s)) throw new NotFoundException('Cita no encontrada');

    // Qué pasa si la clienta cancela hoy (política de anticipos, art. 56): solo con el anticipo pagado, sin
    // retener y la cita vigente. La pantalla de cancelar lo explica con esto.
    let cancelacion: ReturnType<typeof politicaCancelacionAnticipo> = null;
    const respuesta = (estado: EstadoAnticipo, c: typeof cita) => ({
      estado,
      citaEstado: c.estado,
      anticipoRequerido: c.anticipoRequerido === null ? null : Number(c.anticipoRequerido),
      anticipoVenceEn: c.anticipoVenceEn,
      anticipoPagadoEn: c.anticipoPagadoEn,
      anticipoEnSalon: c.anticipoEnSalon,
      cancelacion,
    });
    if (!requiereAnticipo(cita)) return respuesta('no_requiere', cita);

    // Prioridad: un anticipo pagado y aprobado manda aunque haya un duplicado reembolsado o en revisión.
    const pagos = await this.prisma.pago.findMany({ where: { citaId }, select: { estado: true, pagadoEn: true, retenidoEn: true } });
    const hay = (e: EstadoPago) => pagos.some((p) => p.estado === e);
    const aprobado = pagos.find((p) => p.estado === EstadoPago.aprobado && !p.retenidoEn);
    if (cita.anticipoPagadoEn && aprobado && vigente(cita.estado)) {
      cancelacion = politicaCancelacionAnticipo(aprobado.pagadoEn ?? cita.anticipoPagadoEn, cita.fechaHoraInicio, ahora);
    }
    if (cita.anticipoPagadoEn && hay(EstadoPago.aprobado)) return respuesta('aprobado', cita);
    if (hay(EstadoPago.en_revision)) return respuesta('revision', cita);
    if (hay(EstadoPago.reembolsado)) return respuesta('reembolsado', cita);
    if (cita.anticipoPagadoEn) return respuesta('aprobado', cita);
    if (cita.estado === 'cancelada') return respuesta('cancelada', cita);

    const ultimo = await buscarUltimoPagoEnReferencias(this.mercadoPago, referenciasDeBusqueda('cita', citaId));
    if (ultimo?.status === 'approved') {
      // El webhook pudo no haber llegado aún: se aplica aquí con la misma lógica idempotente.
      await this.aplicarPagoAprobadoDeMp(citaId, ultimo);
      cita = await this.citaConServicio(citaId);
      return respuesta(cita.anticipoPagadoEn ? 'aprobado' : 'revision', cita);
    }
    if (ultimo && (ultimo.status === 'rejected' || ultimo.status === 'cancelled')) return respuesta('rechazado', cita);
    if (ultimo) return respuesta('pendiente', cita);
    if (cita.anticipoVenceEn && ahora >= cita.anticipoVenceEn) return respuesta('vencido', cita);
    return respuesta('sin_pago', cita);
  }

  /** El personal cobra el anticipo en el salón: entra al corte con su método y quién cobró. */
  async registrarEnSalon(citaId: number, metodo: MetodoAnticipoSalon, cobradoPorId: string, ahora: Date = new Date()) {
    const cita = await this.prisma.cita.findUnique({ where: { id: citaId } });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    if (!requiereAnticipo(cita)) throw new BadRequestException('Esta cita no pide anticipo');

    const pago = await this.prisma.$transaction(async (tx) => {
      // Condicional: si ya se pagó (en línea o en otra caja) o la cita se liberó, no se cobra dos veces.
      const marcada = await tx.cita.updateMany({
        where: { id: citaId, anticipoPagadoEn: null, estado: { in: [...ESTADOS_CITA_VIGENTE] } },
        data: { anticipoPagadoEn: ahora, estado: 'confirmada' },
      });
      if (marcada.count !== 1) throw new ConflictException('El anticipo ya está pagado o la cita ya no está vigente');
      return tx.pago.create({
        data: {
          citaId,
          intentoNumero: 1,
          monto: cita.anticipoRequerido as Prisma.Decimal,
          moneda: 'MXN',
          metodo: METODO_PAGO_DE_ANTICIPO[metodo],
          estado: EstadoPago.aprobado,
          pagadoEn: ahora,
          cobradoPorId,
        },
      });
    });
    this.eventEmitter.emit('cita.anticipo_pagado', { citaId, clienteId: cita.clienteId });
    return { success: true, data: pago };
  }

  /**
   * Reembolso del anticipo: si cancela el salón (cita cancelada con el pago aprobado) o tras revisar un
   * pago en revisión. Mercado Pago: API de refunds (con clave de idempotencia por pago); en el salón se
   * registra y, si se cobró en efectivo, queda una salida de caja. El pago queda 'reembolsado' una sola vez.
   */
  async reembolsar(citaId: number, solicitanteId: string, opciones: { soloMercadoPago?: boolean; nota?: string } = {}) {
    const cita = await this.prisma.cita.findUnique({ where: { id: citaId } });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    const pago = await this.prisma.pago.findFirst({
      where: {
        citaId,
        // Un anticipo retenido es una decisión firme: ya no se reembolsa.
        OR: [{ estado: EstadoPago.en_revision }, ...(cita.estado === 'cancelada' ? [{ estado: EstadoPago.aprobado, retenidoEn: null }] : [])],
      },
      orderBy: { id: 'desc' },
    });
    if (!pago) throw new ConflictException('No hay un anticipo por reembolsar en esta cita');
    // Reembolso automático (la clienta canceló a tiempo): solo el pago en línea; el del salón lo entrega el personal.
    if (opciones.soloMercadoPago && !(pago.proveedor === PROVEEDOR && pago.referenciaExterna)) {
      return { success: true, data: { pagoId: pago.id, estado: pago.estado } };
    }

    if (pago.proveedor === PROVEEDOR && pago.referenciaExterna) {
      try {
        await this.mercadoPago.reembolsarPago(pago.referenciaExterna, `reembolso-pago-${pago.id}`);
      } catch (e) {
        // Si ya se había reembolsado (desde el panel de Mercado Pago o en un intento anterior que no llegó
        // a guardarse), se registra en lugar de quedar atorado; cualquier otro error se reporta.
        const enMp = await this.mercadoPago.obtenerPago(pago.referenciaExterna).catch(() => null);
        if (enMp?.status !== 'refunded') throw e;
      }
    }
    // En la misma transacción: el pago queda reembolsado y, si el anticipo entró en efectivo a la caja del
    // salón, sale de la caja de quien reembolsa (se descuenta en su siguiente corte).
    try {
      await this.prisma.$transaction(async (tx) => {
        const r = await tx.pago.updateMany({
          where: { id: pago.id, estado: { in: [EstadoPago.aprobado, EstadoPago.en_revision] } },
          data: { estado: EstadoPago.reembolsado, errorMensaje: opciones.nota ?? `Reembolsado por ${solicitanteId}`, reembolsadoEn: new Date() },
        });
        if (r.count !== 1) throw new ConflictException('Este anticipo ya se reembolsó');
        if (esCobroEnEfectivoDelSalon(pago)) {
          await registrarSalidaEfectivo(tx, {
            concepto: 'reembolso_anticipo',
            monto: pago.monto,
            registradoPorId: solicitanteId,
            pagoId: pago.id,
            motivo: `Reembolso del anticipo de la cita ${citaId}`,
          });
        }
      }, TX_HOLGADA);
    } catch (e) {
      // Dos reembolsos simultáneos: la llave única de la salida (pago_id) rechaza el segundo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Este anticipo ya se reembolsó');
      }
      throw e;
    }
    // Aviso en vivo a la clienta (campana y navegador), uno por pago reembolsado.
    this.eventEmitter.emit(EVENTO_REEMBOLSO_REALIZADO, {
      usuarioId: cita.clienteId,
      entidadTipo: 'cita',
      entidadId: citaId,
      monto: Number(pago.monto),
      referencia: `pago-${pago.id}`,
    });
    return { success: true, data: { pagoId: pago.id, estado: EstadoPago.reembolsado } };
  }

  /**
   * La clienta canceló a tiempo según la política de anticipos (CitasService.cancelar no lo retuvo): el anticipo
   * pagado con Mercado Pago se reembolsa solo; el pagado en el salón queda aprobado y sin retener para que el
   * personal lo reembolse, igual que cuando cancela el salón. Nunca lanza: si Mercado Pago falla, también queda
   * para el personal. En los dos casos se avisa a quien maneja la caja (EVENTO_ANTICIPO_POR_DEVOLVER).
   */
  @OnEvent(EVENTO_ANTICIPO_REEMBOLSABLE)
  async alCancelarConReembolso(payload: { citaId: number; solicitanteId: string }): Promise<void> {
    let porDevolver: MotivoAnticipoPorDevolver | null = null;
    try {
      const r = await this.reembolsar(payload.citaId, payload.solicitanteId, {
        soloMercadoPago: true,
        nota: 'Reembolsado al cancelar la clienta dentro del plazo de la política de anticipos (art. 56 LFPC)',
      });
      // Pagado en el salón: reembolsar no lo toca (lo entrega el personal).
      if (r.data.estado !== EstadoPago.reembolsado) porDevolver = 'pagado_en_salon';
    } catch (e) {
      // 409: ya no hay anticipo por reembolsar (otra petición lo resolvió); no hay nada que avisar.
      if (!(e instanceof ConflictException)) porDevolver = 'reembolso_automatico_fallo';
      this.logger.warn(`El anticipo de la cita ${payload.citaId} queda por reembolsar a mano (${e instanceof Error ? e.message : e})`);
    }
    if (porDevolver) this.eventEmitter.emit(EVENTO_ANTICIPO_POR_DEVOLVER, { citaId: payload.citaId, motivo: porDevolver });
  }

  /**
   * Tras revisar un pago en revisión, el salón decide quedarse el anticipo (Términos, sección 6). Solo si la
   * cita ya no se va a cobrar (cancelada o no asistió) y no tiene otro anticipo aprobado: un pago duplicado o
   * de una cita vigente se reembolsa, porque el POS lo descontaría dos veces. La decisión queda firme.
   */
  async retener(citaId: number) {
    const cita = await this.prisma.cita.findUnique({ where: { id: citaId } });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    if (!['cancelada', 'no_asistio'].includes(cita.estado)) {
      throw new ConflictException('Solo se retiene el anticipo de una cita cancelada o en la que la clienta no asistió');
    }
    const pagos = await this.prisma.pago.findMany({ where: { citaId }, select: { id: true, estado: true }, orderBy: { id: 'desc' } });
    if (pagos.some((p) => p.estado === EstadoPago.aprobado)) {
      throw new ConflictException('Esta cita ya tiene un anticipo aprobado: el pago duplicado se reembolsa');
    }
    const enRevision = pagos.find((p) => p.estado === EstadoPago.en_revision);
    if (!enRevision) throw new ConflictException('No hay un anticipo en revisión en esta cita');
    const r = await this.prisma.pago.updateMany({
      where: { id: enRevision.id, estado: EstadoPago.en_revision },
      data: { estado: EstadoPago.aprobado, retenidoEn: new Date() },
    });
    if (r.count !== 1) throw new ConflictException('Este anticipo ya se resolvió');
    return { success: true, data: { citaId, pagoId: enRevision.id, estado: EstadoPago.aprobado } };
  }
}
