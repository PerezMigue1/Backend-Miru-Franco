import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PosService } from '../pos/pos.service';
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

    return {
      success: true,
      data: {
        resumen: { ...resumenRes.data, totalUnidadesVendidas },
        ventas,
      },
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
