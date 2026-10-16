import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AnticiposCitasService } from '../../citas/anticipos/anticipos-citas.service';
import { ESTADOS_CITA_VIGENTE, anticiposDesde } from '../../citas/anticipos/anticipos.util';
import { METODO_PAGO_MERCADOPAGO } from '../pedidos/flujo-pedido';
import { DEFINICIONES_REGLAS } from '../../configuracion-sitio/reglas-negocio';
import { PagosEnLineaService } from './pagos-en-linea.service';
import { avisoEntornoPagos } from './referencia-pago';

export const INTERVALO_VERIFICACION_MS = 10 * 60_000;
export const MINUTOS_MINIMOS_PENDIENTE = 5;
/** Pedidos y citas por pasada: lo que no cabe se revisa en la siguiente. */
const LOTE = 50;
/** Margen tras la vigencia del pedido en línea para un pago que se acreditó al final. */
const MARGEN_VIGENCIA_MS = 60 * 60_000;
function maxHoras(ruta: string): number {
  return DEFINICIONES_REGLAS.find((d) => d.ruta === ruta)?.max ?? 24;
}
/**
 * Citas que se revisan: creadas dentro del plazo en línea más largo que permite el panel, más el margen. La preferencia
 * vence con él, así que después ya no llega un pago nuevo; esto acota la consulta.
 */
const VENTANA_ANTICIPO_MS = Math.max(24, maxHoras('citas.plazoAnticipoHoras')) * 60 * 60_000 + MARGEN_VIGENCIA_MS;
/** Pedidos: el plazo más largo que permite el panel (cada pedido guarda el suyo). */
const VENTANA_PEDIDO_MS = Math.max(24, maxHoras('tienda.plazoPagoLineaHoras')) * 60 * 60_000 + MARGEN_VIGENCIA_MS;

/**
 * Verificación activa periódica de los pagos en línea: cada 10 minutos consulta en Mercado Pago los pedidos y
 * anticipos pendientes con más de 5 minutos y aplica los aprobados con la misma lógica idempotente (y el mismo
 * candado por pago) que el webhook. Rescata los pagos cuyo aviso no llegó.
 */
@Injectable()
export class VerificacionPagosService implements OnModuleInit {
  private readonly logger = new Logger(VerificacionPagosService.name);
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagos: PagosEnLineaService,
    @Optional() private readonly anticipos?: AnticiposCitasService,
  ) {}

  onModuleInit(): void {
    const aviso = avisoEntornoPagos();
    if (aviso) this.logger.warn(aviso);
  }

  @Interval(INTERVALO_VERIFICACION_MS)
  async alIntervalo(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.verificar();
    } catch (e) {
      this.logger.error('Falló la verificación periódica de pagos en línea', e);
    } finally {
      this.corriendo = false;
    }
  }

  async verificar(ahora: Date = new Date()): Promise<{ pedidos: number[]; citas: number[] }> {
    const aplicados = { pedidos: [] as number[], citas: [] as number[] };
    if (!process.env.MP_ACCESS_TOKEN) return aplicados;
    const hace5 = new Date(ahora.getTime() - MINUTOS_MINIMOS_PENDIENTE * 60_000);

    const pedidos = await this.prisma.pedido.findMany({
      where: {
        estado: 'pendiente_pago',
        metodoPago: METODO_PAGO_MERCADOPAGO,
        creadoEn: { lte: hace5, gte: new Date(ahora.getTime() - VENTANA_PEDIDO_MS) },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: LOTE,
    });
    for (const { id } of pedidos) {
      try {
        if ((await this.pagos.verificarPedidoPendiente(id)) === 'pagado') aplicados.pedidos.push(id);
      } catch (e) {
        this.logger.error(`No se pudo verificar en Mercado Pago el pago del pedido ${id}`, e instanceof Error ? e.message : e);
      }
    }

    if (!this.anticipos) return aplicados;
    // También las que pasaron a pago en el salón: la clienta pudo pagar en Mercado Pago antes de cambiar.
    const ventana = new Date(ahora.getTime() - VENTANA_ANTICIPO_MS);
    const desde = anticiposDesde();
    const citas = await this.prisma.cita.findMany({
      where: {
        anticipoRequerido: { gt: 0 },
        anticipoPagadoEn: null,
        estado: { in: [...ESTADOS_CITA_VIGENTE] },
        creadoEn: { lte: hace5, gte: desde && desde > ventana ? desde : ventana },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: LOTE,
    });
    for (const { id } of citas) {
      try {
        if ((await this.anticipos.aplicarPagoAprobadoDeMp(id)) === 'pagado') aplicados.citas.push(id);
      } catch (e) {
        this.logger.error(`No se pudo verificar en Mercado Pago el anticipo de la cita ${id}`, e instanceof Error ? e.message : e);
      }
    }
    return aplicados;
  }
}
