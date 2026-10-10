import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CAJA_POR_METODO_COBRO, PosService } from '../pos/pos.service';
import { InventarioService } from '../inventario/inventario.service';
import { normalizarRangoFechas } from '../common/utils/fecha-rango.util';

@Injectable()
export class ReportesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posService: PosService,
    private readonly inventarioService: InventarioService,
  ) {}

  /** Reutiliza PosService.resumen (mismas agregaciones por método de pago) y le agrega
   *  el listado fila-por-fila + unidades de producto vendidas, para tabla/PDF/Excel. */
  async ventas(desde?: string, hasta?: string) {
    const resumenRes = await this.posService.resumen(desde, hasta);

    const where: Record<string, unknown> = { estado: 'pagada' };
    if (desde || hasta) {
      where.creadoEn = normalizarRangoFechas(desde, hasta);
    }

    const ventas = await this.prisma.ventaLocal.findMany({
      where,
      select: { id: true, folio: true, total: true, metodoPago: true, creadoEn: true },
      orderBy: { creadoEn: 'desc' },
    });

    const itemsProducto = await this.prisma.ventaLocalItem.findMany({
      where: { presentacionId: { not: null }, venta: where },
      select: { cantidad: true },
    });
    const totalUnidadesVendidas = itemsProducto.reduce((acc, i) => acc + i.cantidad, 0);
    const ingresos = await this.ingresos(ventas, where.creadoEn as { gte?: Date; lte?: Date } | undefined);

    return {
      success: true,
      data: {
        resumen: { ...resumenRes.data, totalUnidadesVendidas },
        ingresos,
        ventas,
      },
    };
  }

  /**
   * Ingresos del periodo por fuente. El anticipo de una cita entra una vez, por la tabla pagos y el día en
   * que se pagó (en línea o en el salón, retenidos incluidos); la venta del POS que lo descuenta solo trae el
   * saldo (VentaLocal.total). Los anticipos en revisión y los reembolsados se informan aparte, sin sumar.
   */
  private async ingresos(ventas: { total: Decimal }[], rango?: { gte?: Date; lte?: Date }) {
    const enRango = rango ? { pagadoEn: rango } : {};
    const pagos = await this.prisma.pago.findMany({
      where: {
        OR: [
          // Cobros de pedidos en el salón (los de Mercado Pago llegan a la cuenta en línea, no se suman aquí).
          { pedidoId: { not: null }, estado: 'aprobado', cobradoPorId: { not: null }, metodo: { in: Object.keys(CAJA_POR_METODO_COBRO) }, ...enRango },
          { citaId: { not: null }, estado: { in: ['aprobado', 'en_revision'] }, ...enRango },
          // Reembolsados en el periodo; los anteriores a reembolsado_en, por el día en que se pagaron.
          {
            citaId: { not: null },
            estado: 'reembolsado',
            ...(rango && { OR: [{ reembolsadoEn: rango }, { reembolsadoEn: null, pagadoEn: rango }] }),
          },
        ],
      },
      select: { monto: true, estado: true, citaId: true, pedidoId: true, cobradoPorId: true },
    });

    const suma = (filas: { monto: Decimal }[]) => filas.reduce((acc, f) => acc.add(f.monto), new Decimal(0));
    const anticipos = pagos.filter((p) => p.citaId !== null);
    const aprobados = anticipos.filter((p) => p.estado === 'aprobado');
    const ventasPos = ventas.reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const cobrosPedidosSalon = suma(pagos.filter((p) => p.pedidoId !== null));
    const anticiposEnLinea = suma(aprobados.filter((p) => p.cobradoPorId === null));
    const anticiposEnSalon = suma(aprobados.filter((p) => p.cobradoPorId !== null));
    const totalAnticipos = anticiposEnLinea.add(anticiposEnSalon);

    return {
      total: ventasPos.add(cobrosPedidosSalon).add(totalAnticipos),
      ventasPos,
      cobrosPedidosSalon,
      anticipos: totalAnticipos,
      anticiposEnLinea,
      anticiposEnSalon,
      anticiposEnRevision: suma(anticipos.filter((p) => p.estado === 'en_revision')),
      anticiposReembolsados: suma(anticipos.filter((p) => p.estado === 'reembolsado')),
    };
  }

  /** Citas completadas en el rango, agrupadas por servicio y por especialista. */
  async servicios(desde?: string, hasta?: string) {
    const where: Record<string, unknown> = { estado: 'completada' };
    if (desde || hasta) {
      where.fechaHoraInicio = normalizarRangoFechas(desde, hasta);
    }

    const citas = await this.prisma.cita.findMany({
      where,
      select: {
        servicioId: true,
        especialistaId: true,
        servicio: { select: { nombre: true } },
        especialista: { select: { nombre: true } },
      },
    });

    const porServicioMap = new Map<number, { servicioId: number; servicioNombre: string; cantidad: number }>();
    const porEspecialistaMap = new Map<string, { especialistaId: string; especialistaNombre: string; cantidad: number }>();

    for (const cita of citas) {
      const s = porServicioMap.get(cita.servicioId);
      if (s) s.cantidad += 1;
      else porServicioMap.set(cita.servicioId, { servicioId: cita.servicioId, servicioNombre: cita.servicio.nombre, cantidad: 1 });

      const e = porEspecialistaMap.get(cita.especialistaId);
      if (e) e.cantidad += 1;
      else porEspecialistaMap.set(cita.especialistaId, { especialistaId: cita.especialistaId, especialistaNombre: cita.especialista.nombre, cantidad: 1 });
    }

    return {
      success: true,
      data: {
        totalCompletadas: citas.length,
        porServicio: [...porServicioMap.values()].sort((a, b) => b.cantidad - a.cantidad),
        porEspecialista: [...porEspecialistaMap.values()].sort((a, b) => b.cantidad - a.cantidad),
      },
    };
  }

  /** Foto del stock actual — reutiliza InventarioService.alertasStock, sin duplicar su lógica. */
  async inventario() {
    const [totalPresentaciones, alertas] = await Promise.all([
      this.prisma.productoPresentacion.count(),
      this.inventarioService.alertasStock({}),
    ]);

    return {
      success: true,
      data: {
        totalPresentaciones,
        presentacionesBajoStock: alertas.data,
      },
    };
  }

  /** Clientes (rol='cliente') dados de alta en el rango. */
  async clientes(desde?: string, hasta?: string) {
    const where: Record<string, unknown> = { rol: 'cliente' };
    if (desde || hasta) {
      where.creadoEn = normalizarRangoFechas(desde, hasta);
    }

    const clientes = await this.prisma.usuario.findMany({
      where,
      select: { id: true, nombre: true, email: true, creadoEn: true },
      orderBy: { creadoEn: 'desc' },
    });

    return {
      success: true,
      data: {
        totalNuevos: clientes.length,
        clientes,
      },
    };
  }
}
