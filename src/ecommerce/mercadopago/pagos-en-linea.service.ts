import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EstadoPago, EstadoPedido } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { reglasDePedido } from '../../configuracion-sitio/reglas-negocio';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeVerPedidosDeOtros } from '../common/permisos-pedido.util';
import { METODO_PAGO_MERCADOPAGO } from '../pedidos/flujo-pedido';
import { MercadoPagoClient, PagoMercadoPago } from './mercadopago.client';
import { AnticiposCitasService } from '../../citas/anticipos/anticipos-citas.service';
import { RUTA_RETORNO_APP_PEDIDO } from '../../citas/anticipos/anticipos.util';
import {
  buscarUltimoPagoEnReferencias,
  leerReferencia,
  llaveCandadoPago,
  pagoAnteriorAlRegistro,
  referenciaPedido,
  referenciasDeBusqueda,
} from './referencia-pago';

export type ResultadoPago = 'pagado' | 'ya_procesado' | 'revision' | 'no_aprobado' | 'ignorado' | 'otro_entorno';
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
    @Optional() private readonly anticipos?: AnticiposCitasService,
  ) {}

  async crearPreferencia(pedidoId: number, usuarioId: string, ahora: Date = new Date(), desdeApp = false) {
    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId }, include: { items: true } });
    if (!pedido) throw new NotFoundException('Pedido no encontrado');
    if (pedido.usuarioId !== usuarioId) throw new ForbiddenException('No tienes permiso para pagar este pedido');
    if (pedido.metodoPago !== METODO_PAGO_MERCADOPAGO) {
      throw new BadRequestException('Este pedido se paga al recogerlo en el salón');
    }
    if (pedido.estado !== EstadoPedido.pendiente_pago) {
      throw new ConflictException('Este pedido ya no está pendiente de pago');
    }
    const vence = new Date(new Date(pedido.creadoEn).getTime() + reglasDePedido(pedido.reglas).plazoPagoLineaHoras * 60 * 60_000);
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

    // back_urls y notification_url salen solo de variables de entorno (FRONTEND_URL, BACKEND_URL, MP_WEBHOOK_URL).
    const frontend = (process.env.FRONTEND_URL ?? '').trim().replace(/\/+$/, '');
    // Desde la app, Mercado Pago regresa al backend, que redirige al deep link (así no se abre la web).
    const backend = (process.env.BACKEND_URL ?? '').trim().replace(/\/+$/, '');
    if (!(desdeApp && backend) && !frontend) {
      this.logger.error('FRONTEND_URL no está configurada: Mercado Pago no tendría a dónde regresar');
      throw new ServiceUnavailableException('El pago en línea no está disponible por ahora.');
    }
    const confirmacion = `${frontend}/cliente/tienda-online/confirmacion?pedidoId=${pedido.id}`;
    const regreso = desdeApp && backend ? `${backend}/api/${RUTA_RETORNO_APP_PEDIDO}?pedidoId=${pedido.id}` : confirmacion;
    const cuerpo = {
      items,
      // Con prefijo de entorno: un aviso de otra base (los ids coinciden entre desarrollo y producción) no se aplica aquí.
      external_reference: referenciaPedido(pedido.id),
      back_urls: { success: regreso, failure: regreso, pending: regreso },
      // El regreso automático solo lo acepta Mercado Pago con una URL pública https (en local responde 400
      // invalid_auto_return); sin él, la clienta regresa con el botón "Volver al sitio".
      ...(regreso.startsWith('https://') && { auto_return: 'approved' }),
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

  /**
   * Aplica un pago de Mercado Pago a su pedido. Idempotente: llamarlo varias veces no duplica nada. Un pago con la
   * referencia de otro entorno se rechaza (con registro) sin escribir nada.
   */
  async procesarPago(paymentId: string): Promise<ResultadoPago> {
    const pago = await this.mercadoPago.obtenerPago(paymentId);
    const ref = leerReferencia(pago.external_reference);
    if (!ref) return 'ignorado';
    if (ref.origen === 'otro_entorno') {
      this.logger.warn(`Aviso del pago ${pago.id} con referencia de otro entorno (${pago.external_reference}): se ignora`);
      return 'otro_entorno';
    }
    // Anticipo de cita: misma firma e idempotencia, otra tabla.
    if (ref.tipo === 'cita') return this.anticipos ? this.anticipos.procesarPagoCita(pago, ref.id) : 'ignorado';
    const pedidoId = ref.id;
    if (pago.status !== 'approved') return 'no_aprobado';

    const pedido = await this.prisma.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido) return 'ignorado';
    if (ref.origen === 'sin_prefijo' && pagoAnteriorAlRegistro(pago, pedido.creadoEn)) {
      this.logger.warn(`El pago ${pago.id} (referencia ${pago.external_reference}) es anterior al pedido ${pedidoId}: es de otra base y se ignora`);
      return 'ignorado';
    }

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
      // Candado por pago: el webhook, el regreso y la tarea periódica no lo aplican a la vez.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${llaveCandadoPago(pago.id)}))`;
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

  /**
   * Verificación activa sin sesión (tarea periódica): busca el último pago del pedido en Mercado Pago (referencia nueva
   * y antigua) y, si está aprobado, lo aplica con procesarPago. null si no hay pago aprobado.
   */
  async verificarPedidoPendiente(pedidoId: number): Promise<ResultadoPago | null> {
    const ultimo = await buscarUltimoPagoEnReferencias(this.mercadoPago, referenciasDeBusqueda('pedido', pedidoId));
    if (ultimo?.status !== 'approved') return null;
    return this.procesarPago(String(ultimo.id));
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

    const ultimo: PagoMercadoPago | null = await buscarUltimoPagoEnReferencias(this.mercadoPago, referenciasDeBusqueda('pedido', pedido.id));
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
