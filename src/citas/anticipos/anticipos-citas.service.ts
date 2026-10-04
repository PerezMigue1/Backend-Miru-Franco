import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MercadoPagoClient, PagoMercadoPago } from '../../ecommerce/mercadopago/mercadopago.client';
import { METODO_PAGO_MERCADOPAGO } from '../../ecommerce/pedidos/flujo-pedido';
import { puedeEscribirCualquierCita, type Solicitante } from '../../common/utils/permisos-citas.util';
import {
  ESTADOS_CITA_VIGENTE,
  METODO_PAGO_DE_ANTICIPO,
  type MetodoAnticipoSalon,
  centavos,
  referenciaCita,
  requiereAnticipo,
} from './anticipos.util';

const PROVEEDOR = 'mercadopago';
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

  async crearPreferencia(citaId: number, usuarioId: string, ahora: Date = new Date()) {
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
    const cuerpo = {
      items: [{
        id: referenciaCita(cita.id),
        title: `Anticipo: ${cita.servicio?.nombre ?? 'cita'}`,
        quantity: 1,
        unit_price: Number(cita.anticipoRequerido),
        currency_id: 'MXN',
      }],
      external_reference: referenciaCita(cita.id),
      back_urls: { success: confirmacion, failure: confirmacion, pending: confirmacion },
      ...(confirmacion.startsWith('https://') && { auto_return: 'approved' }),
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

  /** Estado real del anticipo para la confirmación: consulta Mercado Pago, nunca la URL de regreso. */
  async consultarEstado(citaId: number, s: Solicitante, ahora: Date = new Date()) {
    let cita = await this.citaConServicio(citaId);
    if (cita.clienteId !== s.id && !puedeEscribirCualquierCita(s)) throw new NotFoundException('Cita no encontrada');

    const respuesta = (estado: EstadoAnticipo, c: typeof cita) => ({
      estado,
      citaEstado: c.estado,
      anticipoRequerido: c.anticipoRequerido === null ? null : Number(c.anticipoRequerido),
      anticipoVenceEn: c.anticipoVenceEn,
      anticipoPagadoEn: c.anticipoPagadoEn,
    });
    if (!requiereAnticipo(cita)) return respuesta('no_requiere', cita);

    // Prioridad: un anticipo pagado y aprobado manda aunque haya un duplicado reembolsado o en revisión.
    const pagos = await this.prisma.pago.findMany({ where: { citaId }, select: { estado: true } });
    const hay = (e: EstadoPago) => pagos.some((p) => p.estado === e);
    if (cita.anticipoPagadoEn && hay(EstadoPago.aprobado)) return respuesta('aprobado', cita);
    if (hay(EstadoPago.en_revision)) return respuesta('revision', cita);
    if (hay(EstadoPago.reembolsado)) return respuesta('reembolsado', cita);
    if (cita.anticipoPagadoEn) return respuesta('aprobado', cita);
    if (cita.estado === 'cancelada') return respuesta('cancelada', cita);

    const ultimo = await this.mercadoPago.buscarUltimoPago(referenciaCita(citaId));
    if (ultimo?.status === 'approved') {
      // El webhook pudo no haber llegado aún: se aplica aquí con la misma lógica idempotente.
      await this.procesarPagoCita(await this.mercadoPago.obtenerPago(String(ultimo.id)), citaId);
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
   * pago en revisión. Mercado Pago: API de refunds (con clave de idempotencia por pago); en el salón solo
   * se registra. El pago queda 'reembolsado' una sola vez.
   */
  async reembolsar(citaId: number, solicitanteId: string) {
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
    const r = await this.prisma.pago.updateMany({
      where: { id: pago.id, estado: { in: [EstadoPago.aprobado, EstadoPago.en_revision] } },
      data: { estado: EstadoPago.reembolsado, errorMensaje: `Reembolsado por ${solicitanteId}` },
    });
    if (r.count !== 1) throw new ConflictException('Este anticipo ya se reembolsó');
    return { success: true, data: { pagoId: pago.id, estado: EstadoPago.reembolsado } };
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
