import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago, EstadoPedido } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeVerPedidosDeOtros } from '../common/permisos-pedido.util';
import { METODO_PAGO_MERCADOPAGO, VIGENCIA_PEDIDO_EN_LINEA_MS } from '../pedidos/flujo-pedido';
import { MercadoPagoClient, PagoMercadoPago } from './mercadopago.client';

export type ResultadoPago = 'pagado' | 'ya_procesado' | 'revision' | 'no_aprobado' | 'ignorado';
export type EstadoPagoEnLinea = 'aprobado' | 'pendiente' | 'rechazado' | 'revision' | 'sin_pago' | 'cancelado';

const PROVEEDOR = 'mercadopago';
const ESTADOS_YA_PAGADOS: EstadoPedido[] = [
  EstadoPedido.pagado,
  EstadoPedido.preparando,
  EstadoPedido.listo_recoger,
  EstadoPedido.entregado,
];
const centavos = (monto: unknown) => Math.round(Number(monto) * 100);

/**
 * Pago en línea con Mercado Pago Checkout Pro: la clienta paga en la página de Mercado Pago; aquí
 * nunca entra un dato de tarjeta. El monto sale siempre de la base, y un pedido solo se marca pagado
 * después de consultar el pago en la API de Mercado Pago (nunca con lo que diga la notificación).
 */
@Injectable()
export class PagosEnLineaService {
  private readonly logger = new Logger(PagosEnLineaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
    private readonly mercadoPago: MercadoPagoClient,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async crearPreferencia(pedidoId: number, usuarioId: string, ahora: Date = new Date()) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { items: true } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.usuarioId !== usuarioId) throw new ForbiddenException('No tienes permiso para pagar este pedido');
    if (pedido.metodoPago !== METODO_PAGO_MERCADOPAGO) {
      throw new BadRequestException('Este pedido se paga al recogerlo en el salón');
    }
    if (pedido.estado !== EstadoPedido.pendiente_pago) {
      throw new ConflictException('Este pedido ya no está pendiente de pago');
    }
    const vence = new Date(new Date(pedido.creadoEn).getTime() + VIGENCIA_PEDIDO_EN_LINEA_MS);
    if (ahora >= vence) throw new ConflictException('Este pedido venció: vuelve a hacer tu compra');

    const items = pedido.items.map((i) => ({
      id: String(i.presentacionId),
      title: [i.nombreProducto ?? 'Producto', i.tamanio].filter(Boolean).join(' '),
      quantity: i.cantidad,
      unit_price: Number(i.precioUnitario),
      currency_id: 'MXN',
    }));
    const sumaItems = items.reduce((s, i) => s + centavos(i.unit_price) * i.quantity, 0);
    if (sumaItems !== centavos(pedido.total)) {
      this.logger.warn(`El total del pedido ${pedido.id} no cuadra con sus artículos; no se crea la preferencia`);
      throw new ConflictException('El total del pedido no coincide con sus productos. Contáctanos para revisarlo.');
    }

    const confirmacion = `${(process.env.FRONTEND_URL ?? '').replace(/\/+$/, '')}/cliente/tienda-online/confirmacion?pedidoId=${pedido.id}`;
    const cuerpo = {
      items,
      external_reference: String(pedido.id),
      back_urls: { success: confirmacion, failure: confirmacion, pending: confirmacion },
      // El regreso automático solo lo acepta Mercado Pago con una URL pública https (en local responde 400
      // invalid_auto_return); sin él, la clienta regresa con el botón "Volver al sitio".
      ...(confirmacion.startsWith('https://') && { auto_return: 'approved' }),
      expires: true,
      expiration_date_from: ahora.toISOString(),
      expiration_date_to: vence.toISOString(),
      // Sin pagos en efectivo o en cajero: se acreditan días después y el pedido vence a las 24 h.
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      statement_descriptor: 'MIRU FRANCO',
      ...(process.env.MP_WEBHOOK_URL ? { notification_url: process.env.MP_WEBHOOK_URL } : {}),
    };
    const preferencia = await this.mercadoPago.crearPreferencia(cuerpo, randomUUID());
    return { initPoint: preferencia.init_point };
  }

  /** Aplica un pago de Mercado Pago a su pedido. Idempotente: llamarlo varias veces no duplica nada. */
  async procesarPago(paymentId: string): Promise<ResultadoPago> {
    const pago = await this.mercadoPago.obtenerPago(paymentId);
    const pedidoId = Number(pago.external_reference);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) return 'ignorado';
    if (pago.status !== 'approved') return 'no_aprobado';

    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido) return 'ignorado';

    const montoCorrecto = pago.currency_id === 'MXN' && centavos(pago.transaction_amount) === centavos(pedido.total);
    const referencia = String(pago.id);
    const pagadoEn = pago.date_approved ? new Date(pago.date_approved) : new Date();
    const filaPago = (estado: EstadoPago) => ({
      pedidoId,
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
        // Solo un pedido que sigue pendiente pasa a pagado; si llega dos veces, la segunda no cambia nada.
        const marcado = await tx.pedido.updateMany({
          where: { id: pedidoId, estado: EstadoPedido.pendiente_pago },
          data: { estado: EstadoPedido.pagado, pagadoEn, referenciaPago: referencia },
        });
        if (marcado.count === 1) {
          await tx.pago.createMany({ data: [filaPago(EstadoPago.aprobado)], skipDuplicates: true });
          await tx.historialEstadoPedido.create({
            data: {
              pedidoId,
              estadoAnterior: EstadoPedido.pendiente_pago,
              estadoNuevo: EstadoPedido.pagado,
              origen: 'webhook.mercadopago',
            },
          });
          return 'pagado' as const;
        }
      }
      // Dinero recibido que no se puede aplicar (pedido cancelado o ya pagado, o monto distinto): se registra
      // una sola vez (llave única proveedor + referencia) para que el admin revise la devolución.
      const registrado = await tx.pago.createMany({ data: [filaPago(EstadoPago.en_revision)], skipDuplicates: true });
      return registrado.count === 1 ? ('revision' as const) : ('ya_procesado' as const);
    });

    if (resultado === 'pagado') {
      this.eventEmitter.emit('pedido.pagado', { pedidoId, usuarioId: pedido.usuarioId });
    } else if (resultado === 'revision') {
      this.logger.warn(`Pago ${referencia} del pedido ${pedidoId} quedó en revisión`);
      this.eventEmitter.emit('pago.requiere_revision', {
        pedidoId,
        referencia,
        motivo: montoCorrecto ? 'pedido_no_pendiente' : 'monto_distinto',
        estadoPedido: pedido.estado,
      });
    }
    return resultado;
  }

  /** Estado real del pago para la confirmación (no se fía de los parámetros de la URL de regreso). */
  async consultarEstado(pedidoId: number, solicitanteId: string): Promise<{ estado: EstadoPagoEnLinea; pedidoEstado: EstadoPedido }> {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.usuarioId !== solicitanteId) {
      const rol = await this.access.getRol(solicitanteId);
      if (!(await puedeVerPedidosDeOtros(this.prisma, rol))) {
        throw new ForbiddenException('No tienes permiso para acceder a este recurso');
      }
    }

    const respuesta = (estado: EstadoPagoEnLinea, p: { estado: EstadoPedido }) => ({ estado, pedidoEstado: p.estado });
    if (ESTADOS_YA_PAGADOS.includes(pedido.estado)) return respuesta('aprobado', pedido);
    if (pedido.estado === EstadoPedido.cancelado) return respuesta('cancelado', pedido);
    // Solo los pedidos pagados en línea tienen un pago en Mercado Pago que consultar.
    if (pedido.estado !== EstadoPedido.pendiente_pago || pedido.metodoPago !== METODO_PAGO_MERCADOPAGO) {
      return respuesta('sin_pago', pedido);
    }

    const ultimo: PagoMercadoPago | null = await this.mercadoPago.buscarUltimoPago(String(pedido.id));
    if (!ultimo) return respuesta('sin_pago', pedido);
    if (ultimo.status === 'approved') {
      // El webhook pudo no haber llegado aún: se procesa aquí con la misma lógica idempotente.
      await this.procesarPago(String(ultimo.id));
      const actual = (await this.prisma.pedido.findUnique({ where: { id: pedidoId } })) ?? pedido;
      return respuesta(ESTADOS_YA_PAGADOS.includes(actual.estado) ? 'aprobado' : 'revision', actual);
    }
    if (ultimo.status === 'rejected' || ultimo.status === 'cancelled') return respuesta('rechazado', pedido);
    return respuesta('pendiente', pedido);
  }
}
