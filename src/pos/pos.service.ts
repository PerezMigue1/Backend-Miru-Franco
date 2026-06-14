import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CancelarVentaDto } from './dto/cancelar-venta.dto';
import { ListVentasDto } from './dto/list-ventas.dto';
import { CreateCorteDto } from './dto/create-corte.dto';
import { ListCortesDto } from './dto/list-cortes.dto';

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventarioService: InventarioService,
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
        },
      },
    } as const;
  }

  private generarFolio(id: number): string {
    return `VL-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
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
      const rango: Record<string, Date> = {};
      if (query.desde) rango.gte = new Date(query.desde);
      if (query.hasta) rango.lte = new Date(query.hasta);
      where.creadoEn = rango;
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

  async crearVenta(dto: CreateVentaDto, cajeroId: string) {
    // 1. Validar cada presentación y calcular precios
    const itemsValidados: Array<{
      presentacionId: number;
      cantidad: number;
      precioUnitario: Decimal;
      subtotal: Decimal;
      stock: number;
    }> = [];

    for (const item of dto.items) {
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
        presentacionId: item.presentacionId,
        cantidad:       item.cantidad,
        precioUnitario,
        subtotal:       precioUnitario.mul(item.cantidad),
        stock:          presentacion.stock,
      });
    }

    // 2. Calcular totales
    const subtotal  = itemsValidados.reduce((acc, i) => acc.add(i.subtotal), new Decimal(0));
    const descuento = new Decimal(dto.descuento ?? 0);
    const total     = Decimal.max(subtotal.sub(descuento), new Decimal(0));

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notas && containsSQLInjection(notas)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }

    // 3. Crear venta + items en transacción, luego actualizar folio
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
              cantidad:       i.cantidad,
              precioUnitario: i.precioUnitario,
              subtotal:       i.subtotal,
            })),
          },
        },
        include: this.incluirVentaRelaciones(),
      });

      const folio = this.generarFolio(nueva.id);
      return tx.ventaLocal.update({
        where: { id: nueva.id },
        data: { folio },
        include: this.incluirVentaRelaciones(),
      });
    });

    // 4. Registrar salidas de inventario (post-transaction; stock pre-validado)
    for (const item of itemsValidados) {
      await this.inventarioService.registrarSalida(
        {
          presentacionId: item.presentacionId,
          cantidad:       item.cantidad,
          motivo:         'venta en mostrador',
          referenciaTipo: 'venta_local',
          referenciaId:   venta.id.toString(),
        },
        cajeroId,
      );
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

    await this.prisma.ventaLocal.update({
      where: { id },
      data: { estado: 'cancelada', motivoCancelacion: motivoLimpio },
    });

    // Revertir inventario: una entrada por cada item
    for (const item of venta.items) {
      await this.inventarioService.registrarEntrada(
        {
          presentacionId: item.presentacionId,
          cantidad:       item.cantidad,
          motivo:         'cancelación de venta',
          referenciaTipo: 'venta_local',
          referenciaId:   id.toString(),
        },
        cajeroId,
      );
    }

    const ventaActualizada = await this.prisma.ventaLocal.findUnique({
      where: { id },
      include: this.incluirVentaRelaciones(),
    });
    return { success: true, data: ventaActualizada };
  }

  // ─── resumen ─────────────────────────────────────────────────────────────────

  async resumen(desde?: string, hasta?: string) {
    const where: Record<string, unknown> = { estado: 'pagada' };
    if (desde || hasta) {
      const rango: Record<string, Date> = {};
      if (desde) rango.gte = new Date(desde);
      if (hasta) rango.lte = new Date(hasta);
      where.creadoEn = rango;
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
      const rango: Record<string, Date> = {};
      if (query.desde) rango.gte = new Date(query.desde);
      if (query.hasta) rango.lte = new Date(query.hasta);
      where.fecha = rango;
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
    if (isNaN(fecha.getTime())) throw new BadRequestException('Fecha inválida');

    // Calcular totales del turno para esa fecha
    const inicioDia = new Date(dto.fecha + 'T00:00:00.000Z');
    const finDia    = new Date(dto.fecha + 'T23:59:59.999Z');

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
