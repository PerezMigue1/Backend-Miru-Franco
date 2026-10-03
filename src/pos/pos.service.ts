import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { normalizarRangoFechas, normalizarRangoFechasSoloDia } from '../common/utils/fecha-rango.util';
import { diaEnMexico, esDiaValido, rangoDiaMexico } from '../common/utils/zona-mexico';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CancelarVentaDto } from './dto/cancelar-venta.dto';
import { ListVentasDto } from './dto/list-ventas.dto';
import { CreateCorteDto } from './dto/create-corte.dto';
import { ListCortesDto } from './dto/list-cortes.dto';

/**
 * Día (en México) del corte: 'YYYY-MM-DD' tal cual; si llega con hora (ISO completo), su día en
 * México. Cortar el texto (`fecha.slice(0, 10)`) daría el día UTC.
 */
export function diaDelCorte(fecha: string): string {
  return esDiaValido(fecha) ? fecha : diaEnMexico(new Date(fecha));
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventarioService: InventarioService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── helpers ────────────────────────────────────────────────────────────────

  private incluirVentaRelaciones() {
    return {
      cajero:  { select: { id: true, nombre: true, rol: true } },
      cliente: { select: { id: true, nombre: true, email: true, telefono: true } },
      items: {
        include: {
          presentacion: {
            select: {
              id: true, tamanio: true, precio: true,
              producto: { select: { id: true, nombre: true, marca: true } },
            },
          },
          servicio: {
            select: { id: true, nombre: true, precio: true, duracionMinutos: true },
          },
        },
      },
    } as const;
  }

  private generarFolio(id: number): string {
    // Año de México: el 31 de diciembre después de las 18:00 el servidor (UTC) ya va en el siguiente.
    return `VL-${diaEnMexico().slice(0, 4)}-${String(id).padStart(6, '0')}`;
  }

  // ─── ventas ─────────────────────────────────────────────────────────────────

  async listarVentas(query: ListVentasDto) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.estado)   where.estado   = query.estado;
    if (query.cajeroId) where.cajeroId = query.cajeroId;
    if (query.clienteId) where.clienteId = query.clienteId;
    if (query.desde || query.hasta) {
      where.creadoEn = normalizarRangoFechas(query.desde, query.hasta);
    }

    const [total, ventas] = await this.prisma.$transaction([
      this.prisma.ventaLocal.count({ where }),
      this.prisma.ventaLocal.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: this.incluirVentaRelaciones(),
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: ventas,
    };
  }

  async obtenerVenta(id: number) {
    const venta = await this.prisma.ventaLocal.findUnique({
      where: { id },
      include: this.incluirVentaRelaciones(),
    });
    if (!venta) throw new NotFoundException(`Venta ${id} no encontrada`);
    return { success: true, data: venta };
  }

  /**
   * El cliente descarga SU ticket — verificación de propiedad aquí, no en el guard
   * (que solo exige estar autenticado). Si la venta es de otro cliente, 403 sin
   * incluir ningún dato de la venta en el mensaje.
   */
  async obtenerMiTicket(id: number, usuarioId: string) {
    const venta = await this.prisma.ventaLocal.findUnique({
      where: { id },
      include: this.incluirVentaRelaciones(),
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (venta.clienteId !== usuarioId) {
      throw new ForbiddenException('No tienes permiso para acceder a esta venta');
    }
    return { success: true, data: venta };
  }

  async crearVenta(dto: CreateVentaDto, cajeroId: string) {
    // 1. Validar cada ítem (producto O servicio) y calcular precios
    const itemsValidados: Array<{
      presentacionId: number | null;
      servicioId: number | null;
      cantidad: number;
      precioUnitario: Decimal;
      subtotal: Decimal;
    }> = [];

    for (const item of dto.items) {
      const tienePresentacion = item.presentacionId !== undefined && item.presentacionId !== null;
      const tieneServicio     = item.servicioId !== undefined && item.servicioId !== null;
      if (tienePresentacion === tieneServicio) {
        throw new BadRequestException(
          'Cada ítem debe tener exactamente uno: presentacionId (producto) o servicioId (servicio)',
        );
      }

      if (tienePresentacion) {
        const presentacion = await this.prisma.productoPresentacion.findUnique({
          where: { id: item.presentacionId },
          select: { id: true, precio: true, stock: true, disponible: true },
        });
        if (!presentacion || !presentacion.disponible) {
          throw new NotFoundException(`Presentación ${item.presentacionId} no encontrada o no disponible`);
        }
        if (presentacion.stock < item.cantidad) {
          throw new BadRequestException(
            `Stock insuficiente para presentación ${item.presentacionId}: disponible ${presentacion.stock}, solicitado ${item.cantidad}`,
          );
        }
        const precioUnitario = item.precioUnitario !== undefined
          ? new Decimal(item.precioUnitario)
          : presentacion.precio;
        itemsValidados.push({
          presentacionId: item.presentacionId!,
          servicioId:     null,
          cantidad:       item.cantidad,
          precioUnitario,
          subtotal:       precioUnitario.mul(item.cantidad),
        });
      } else {
        const servicio = await this.prisma.servicio.findUnique({
          where: { id: item.servicioId },
          select: { id: true, precio: true, activo: true },
        });
        if (!servicio || !servicio.activo) {
          throw new NotFoundException(`Servicio ${item.servicioId} no encontrado o inactivo`);
        }
        const precioUnitario = item.precioUnitario !== undefined
          ? new Decimal(item.precioUnitario)
          : servicio.precio;
        itemsValidados.push({
          presentacionId: null,
          servicioId:     item.servicioId!,
          cantidad:       item.cantidad,
          precioUnitario,
          subtotal:       precioUnitario.mul(item.cantidad),
        });
      }
    }

    // 2. Calcular totales
    const subtotal  = itemsValidados.reduce((acc, i) => acc.add(i.subtotal), new Decimal(0));
    const descuento = new Decimal(dto.descuento ?? 0);
    const total     = Decimal.max(subtotal.sub(descuento), new Decimal(0));

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notas && containsSQLInjection(notas)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }

    // 3. Crear venta + items + descuento de inventario, TODO en una transacción.
    //    Si alguna salida falla (stock insuficiente por concurrencia), se revierte la venta completa.
    const venta = await this.prisma.$transaction(async (tx) => {
      const nueva = await tx.ventaLocal.create({
        data: {
          folio:      'TMP',
          estado:     'pagada',
          metodoPago: dto.metodoPago as any,
          subtotal,
          descuento,
          total,
          notas,
          cajeroId,
          clienteId: dto.clienteId ?? null,
          items: {
            create: itemsValidados.map((i) => ({
              presentacionId: i.presentacionId,
              servicioId:     i.servicioId,
              cantidad:       i.cantidad,
              precioUnitario: i.precioUnitario,
              subtotal:       i.subtotal,
            })),
          },
        },
      });

      const folio = this.generarFolio(nueva.id);

      // Descontar inventario dentro de la misma transacción (atómico con la venta).
      // Solo los ítems de producto (presentacionId) mueven inventario; los servicios no.
      for (const item of itemsValidados) {
        if (item.presentacionId == null) continue;
        await this.inventarioService.registrarSalida(
          {
            presentacionId: item.presentacionId,
            cantidad:       item.cantidad,
            motivo:         'venta en mostrador',
            referenciaTipo: 'venta_local',
            referenciaId:   nueva.id.toString(),
          },
          cajeroId,
          tx,
        );
      }

      return tx.ventaLocal.update({
        where: { id: nueva.id },
        data: { folio },
        include: this.incluirVentaRelaciones(),
      });
    });

    // Fuera de la transacción a propósito: la venta ya está comprometida en BD en este
    // punto. Un fallo aquí nunca debe poder revertir la venta — por eso nunca se hace
    // dentro del `$transaction` de arriba. Antes creaba la notificación directo
    // (prisma.notificacion.create suelto, se perdía si fallaba); ahora emite el evento
    // de dominio y el listener (src/notificaciones/notificaciones.listener.ts) la
    // recrea vía Outbox con el mismo titulo/mensaje/metadata — mismo resultado visible
    // para el cliente, con reintento futuro si el listener falla.
    if (venta.clienteId) {
      this.eventEmitter.emit('venta_local.pagada', {
        ventaId: venta.id,
        clienteId: venta.clienteId,
        folio: venta.folio,
        total: Number(venta.total),
        creadoEn: venta.creadoEn,
      });
    }

    return { success: true, data: venta };
  }

  async cancelarVenta(id: number, dto: CancelarVentaDto, cajeroId: string) {
    const venta = await this.prisma.ventaLocal.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!venta) throw new NotFoundException(`Venta ${id} no encontrada`);
    if (venta.estado === 'cancelada') {
      throw new BadRequestException('La venta ya está cancelada');
    }

    const motivoLimpio = sanitizeInput(dto.motivoCancelacion);
    if (containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('El motivo contiene caracteres no permitidos');
    }

    // Cancelar y revertir inventario en una sola transacción (atómico).
    const ventaActualizada = await this.prisma.$transaction(async (tx) => {
      await tx.ventaLocal.update({
        where: { id },
        data: { estado: 'cancelada', motivoCancelacion: motivoLimpio },
      });

      // Revertir inventario: una entrada por cada item de producto (los servicios no mueven stock)
      for (const item of venta.items) {
        if (item.presentacionId == null) continue;
        await this.inventarioService.registrarEntrada(
          {
            presentacionId: item.presentacionId,
            cantidad:       item.cantidad,
            motivo:         'cancelación de venta',
            referenciaTipo: 'venta_local',
            referenciaId:   id.toString(),
          },
          cajeroId,
          tx,
        );
      }

      return tx.ventaLocal.findUnique({
        where: { id },
        include: this.incluirVentaRelaciones(),
      });
    });

    return { success: true, data: ventaActualizada };
  }

  // ─── resumen ─────────────────────────────────────────────────────────────────

  async resumen(desde?: string, hasta?: string) {
    const where: Record<string, unknown> = { estado: 'pagada' };
    if (desde || hasta) {
      where.creadoEn = normalizarRangoFechas(desde, hasta);
    }

    const ventas = await this.prisma.ventaLocal.findMany({
      where,
      select: { total: true, metodoPago: true },
    });

    const totalVentas       = ventas.length;
    const totalMonto        = ventas.reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalEfectivo     = ventas.filter((v) => v.metodoPago === 'efectivo').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalTarjeta      = ventas.filter((v) => v.metodoPago === 'tarjeta').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalTransferencia = ventas.filter((v) => v.metodoPago === 'transferencia').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalMixto        = ventas.filter((v) => v.metodoPago === 'mixto').reduce((acc, v) => acc.add(v.total), new Decimal(0));

    return {
      success: true,
      data: {
        totalVentas,
        totalMonto,
        porMetodo: { efectivo: totalEfectivo, tarjeta: totalTarjeta, transferencia: totalTransferencia, mixto: totalMixto },
      },
    };
  }

  // ─── cortes de caja ──────────────────────────────────────────────────────────

  async listarCortes(query: ListCortesDto) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.cajeroId) where.cajeroId = query.cajeroId;
    if (query.desde || query.hasta) {
      // CorteCaja.fecha guarda el día del corte a medianoche UTC: se filtra por día UTC. Con el
      // rango de México, el corte del día D aparecía al filtrar por D-1.
      where.fecha = normalizarRangoFechasSoloDia(query.desde, query.hasta);
    }

    const [total, cortes] = await this.prisma.$transaction([
      this.prisma.corteCaja.count({ where }),
      this.prisma.corteCaja.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fecha: 'desc' },
        include: { cajero: { select: { id: true, nombre: true, rol: true } } },
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: cortes,
    };
  }

  async obtenerCorte(id: number) {
    const corte = await this.prisma.corteCaja.findUnique({
      where: { id },
      include: {
        cajero: { select: { id: true, nombre: true, rol: true } },
        ventas: { include: this.incluirVentaRelaciones() },
      },
    });
    if (!corte) throw new NotFoundException(`Corte de caja ${id} no encontrado`);
    return { success: true, data: corte };
  }

  async crearCorte(dto: CreateCorteDto, cajeroId: string) {
    const fecha = new Date(dto.fecha);
    // Un día imposible ('2026-02-30') pasa @IsDateString y se desbordaría a otro día.
    if (isNaN(fecha.getTime()) || (/^\d{4}-\d{2}-\d{2}$/.test(dto.fecha) && !esDiaValido(dto.fecha))) {
      throw new BadRequestException('Fecha inválida');
    }

    // Totales del turno: ventas de las 00:00 a las 23:59:59.999 hora de México de ese día. Antes se
    // usaba el día UTC y las ventas desde las 18:00 de México caían en el corte del día siguiente.
    const { desde: inicioDia, hasta: finDia } = rangoDiaMexico(diaDelCorte(dto.fecha));

    const ventas = await this.prisma.ventaLocal.findMany({
      where: {
        estado:    'pagada',
        cajeroId,
        creadoEn:  { gte: inicioDia, lte: finDia },
        corteId:   null,
      },
      select: { id: true, total: true, metodoPago: true },
    });

    const totalVentas        = ventas.reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalEfectivo      = ventas.filter((v) => v.metodoPago === 'efectivo').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalTarjeta       = ventas.filter((v) => v.metodoPago === 'tarjeta').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const totalTransferencia = ventas.filter((v) => v.metodoPago === 'transferencia').reduce((acc, v) => acc.add(v.total), new Decimal(0));
    const efectivoFinal      = new Decimal(dto.efectivoFinal);
    const efectivoInicial    = new Decimal(dto.efectivoInicial);
    // diferencia = efectivo_final - (efectivo_inicial + total_ventas_efectivo)
    const diferencia = efectivoFinal.sub(efectivoInicial.add(totalEfectivo));

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;

    const corte = await this.prisma.$transaction(async (tx) => {
      const nuevo = await tx.corteCaja.create({
        data: {
          fecha,
          efectivoInicial,
          efectivoFinal,
          totalVentas,
          totalEfectivo,
          totalTarjeta,
          totalTransferencia,
          diferencia,
          notas,
          cajeroId,
        },
        include: { cajero: { select: { id: true, nombre: true, rol: true } } },
      });

      // Vincular ventas del turno a este corte
      if (ventas.length > 0) {
        await tx.ventaLocal.updateMany({
          where: { id: { in: ventas.map((v) => v.id) } },
          data: { corteId: nuevo.id },
        });
      }

      return nuevo;
    });

    return { success: true, data: { ...corte, ventasVinculadas: ventas.length } };
  }
}
