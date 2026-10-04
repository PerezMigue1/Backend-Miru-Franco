import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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

/** Método de cobro de un pedido en el salón → total del corte donde se suma. */
const CAJA_POR_METODO_COBRO: Record<string, 'efectivo' | 'tarjeta' | 'transferencia'> = {
  efectivo: 'efectivo',
  tarjeta_terminal: 'tarjeta',
  transferencia: 'transferencia',
};

/**
 * Día (en México) del corte: 'YYYY-MM-DD' tal cual; si llega con hora (ISO completo), su día en
 * México. Cortar el texto (`fecha.slice(0, 10)`) daría el día UTC.
 */
export function diaDelCorte(fecha: string): string {
  return esDiaValido(fecha) ? fecha : diaEnMexico(new Date(fecha));
}

/** Personal que puede participar en un servicio cobrado. */
const ROLES_PERSONAL = ['estilista', 'empleado', 'becario', 'admin'];

type ItemValidado = {
  presentacionId: number | null;
  servicioId: number | null;
  cantidad: number;
  precioUnitario: Decimal;
  subtotal: Decimal;
  citaId: number | null;
  especialistaId: string | null;
  participantes: string[];
};

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
    // 1. Validar cada ítem (producto O servicio). El precio sale SIEMPRE de la base: el que mande el
    //    frontend se ignora. Para bajar el precio está el campo descuento, con motivo.
    const itemsValidados: ItemValidado[] = [];
    const citasEnTicket = new Set<number>();

    for (const item of dto.items) {
      const tienePresentacion = item.presentacionId !== undefined && item.presentacionId !== null;
      const tieneServicio     = item.servicioId !== undefined && item.servicioId !== null;
      if (tienePresentacion === tieneServicio) {
        throw new BadRequestException(
          'Cada ítem debe tener exactamente uno: presentacionId (producto) o servicioId (servicio)',
        );
      }

      if (tienePresentacion) {
        if (item.citaId !== undefined || (item.participantes?.length ?? 0) > 0) {
          throw new BadRequestException('Solo las líneas de servicio llevan cita o participantes');
        }
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
        const precioUnitario = new Decimal(presentacion.precio);
        itemsValidados.push({
          presentacionId: item.presentacionId!,
          servicioId:     null,
          cantidad:       item.cantidad,
          precioUnitario,
          subtotal:       precioUnitario.mul(item.cantidad),
          citaId:         null,
          especialistaId: null,
          participantes:  [],
        });
        continue;
      }

      const servicio = await this.prisma.servicio.findUnique({
        where: { id: item.servicioId },
        select: { id: true, precio: true, activo: true },
      });
      if (!servicio || !servicio.activo) {
        throw new NotFoundException(`Servicio ${item.servicioId} no encontrado o inactivo`);
      }

      let especialistaId: string | null = null;
      let citaId: number | null = null;
      if (item.citaId !== undefined && item.citaId !== null) {
        if (citasEnTicket.has(item.citaId)) throw new ConflictException(`La cita ${item.citaId} está dos veces en el ticket`);
        citasEnTicket.add(item.citaId);
        const cita = await this.prisma.cita.findUnique({
          where: { id: item.citaId },
          select: { id: true, estado: true, servicioId: true, especialistaId: true, ventaItem: { select: { id: true } } },
        });
        if (!cita) throw new NotFoundException(`Cita ${item.citaId} no encontrada`);
        if (cita.ventaItem) throw new ConflictException(`La cita ${item.citaId} ya se cobró`);
        if (cita.estado !== 'completada') throw new BadRequestException('Solo se cobra una cita ya finalizada');
        if (cita.servicioId !== item.servicioId) throw new BadRequestException('El servicio no coincide con el de la cita');
        if (item.cantidad !== 1) throw new BadRequestException('Una cita se cobra con cantidad 1');
        citaId = cita.id;
        especialistaId = cita.especialistaId;
      }

      // La especialista de la cita siempre participa; las demás las elige quien cobra.
      const participantes = [...new Set([...(especialistaId ? [especialistaId] : []), ...(item.participantes ?? [])])];
      const precioUnitario = new Decimal(servicio.precio);
      itemsValidados.push({
        presentacionId: null,
        servicioId:     item.servicioId!,
        cantidad:       item.cantidad,
        precioUnitario,
        subtotal:       precioUnitario.mul(item.cantidad),
        citaId,
        especialistaId,
        participantes,
      });
    }

    // Participantes elegidas: solo personal activo. La especialista de la cita no se revisa (pudo darse de
    // baja después de atender y la cita se cobra igual). Comisión fija por servicio para quien tiene recibe_comisiones.
    const idsParticipantes = [...new Set(itemsValidados.flatMap((i) => i.participantes))];
    const idsElegidos = [...new Set(itemsValidados.flatMap((i) => i.participantes.filter((p) => p !== i.especialistaId)))];
    const recibenComision = new Set<string>();
    if (idsParticipantes.length > 0) {
      const personal = idsElegidos.length > 0
        ? await this.prisma.usuario.findMany({
            where: { id: { in: idsElegidos } },
            select: { id: true, rol: true, activo: true },
          })
        : [];
      const validos = new Set(personal.filter((u) => u.activo && ROLES_PERSONAL.includes(u.rol)).map((u) => u.id));
      const invalido = idsElegidos.find((id) => !validos.has(id));
      if (invalido) throw new BadRequestException(`El participante ${invalido} no es parte del personal activo`);
      const perfiles = await this.prisma.perfilEmpleado.findMany({
        where: { usuarioId: { in: idsParticipantes }, recibeComisiones: true },
        select: { usuarioId: true },
      });
      for (const p of perfiles) recibenComision.add(p.usuarioId);
    }
    const comisionPorServicio = new Map<number, Decimal>();
    for (const servicioId of new Set(itemsValidados.filter((i) => i.participantes.length > 0).map((i) => i.servicioId!))) {
      const comision = await this.prisma.comisionServicio.findUnique({
        where: { servicioId },
        select: { monto: true, activo: true },
      });
      if (comision?.activo) comisionPorServicio.set(servicioId, new Decimal(comision.monto));
    }

    // 2. Calcular totales. El descuento es el único ajuste de precio y requiere motivo.
    const subtotal  = itemsValidados.reduce((acc, i) => acc.add(i.subtotal), new Decimal(0));
    const descuento = new Decimal(dto.descuento ?? 0);
    const motivoDescuento = dto.motivoDescuento ? sanitizeInput(dto.motivoDescuento).trim() : '';
    if (descuento.gt(0) && !motivoDescuento) {
      throw new BadRequestException('Indica el motivo del descuento');
    }
    if (descuento.gt(subtotal)) {
      throw new BadRequestException('El descuento no puede ser mayor que el subtotal');
    }
    const total = subtotal.sub(descuento);

    // Pago mixto: el reparto por método es obligatorio y debe sumar el total (entra así al corte).
    let montosMixto: { montoEfectivo: Decimal; montoTarjeta: Decimal; montoTransferencia: Decimal } | null = null;
    if (dto.metodoPago === 'mixto') {
      if (!dto.pagos) throw new BadRequestException('Un pago mixto necesita cuánto fue en efectivo, tarjeta y transferencia');
      montosMixto = {
        montoEfectivo: new Decimal(dto.pagos.efectivo ?? 0),
        montoTarjeta: new Decimal(dto.pagos.tarjeta ?? 0),
        montoTransferencia: new Decimal(dto.pagos.transferencia ?? 0),
      };
      const suma = montosMixto.montoEfectivo.add(montosMixto.montoTarjeta).add(montosMixto.montoTransferencia);
      if (!suma.equals(total)) {
        throw new BadRequestException(`El pago mixto suma ${suma.toFixed(2)} y el total es ${total.toFixed(2)}`);
      }
    } else if (dto.pagos) {
      throw new BadRequestException('Solo los pagos mixtos llevan desglose por método');
    }

    const notasBase = dto.notas ? sanitizeInput(dto.notas) : '';
    if (notasBase && containsSQLInjection(notasBase)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }
    if (motivoDescuento && containsSQLInjection(motivoDescuento)) {
      throw new BadRequestException('El motivo del descuento contiene caracteres no permitidos');
    }
    const notas = [notasBase, descuento.gt(0) ? `Descuento: ${motivoDescuento}` : ''].filter(Boolean).join(' · ') || null;

    // 3. Crear venta + items + descuento de inventario, TODO en una transacción.
    //    Si alguna salida falla (stock insuficiente por concurrencia), se revierte la venta completa.
    const crear = () => this.prisma.$transaction(async (tx) => {
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
          ...(montosMixto ?? {}),
          items: {
            create: itemsValidados.map((i) => ({
              presentacionId: i.presentacionId,
              servicioId:     i.servicioId,
              cantidad:       i.cantidad,
              precioUnitario: i.precioUnitario,
              subtotal:       i.subtotal,
              citaId:         i.citaId,
              especialistaId: i.especialistaId,
              ...(i.participantes.length > 0 && {
                participantes: {
                  create: i.participantes.map((usuarioId) => {
                    const monto = comisionPorServicio.get(i.servicioId!);
                    return {
                      usuarioId,
                      // Foto del monto al cobrar: si después cambia la comisión, esta venta no cambia.
                      comisionMonto: monto && recibenComision.has(usuarioId) ? monto.mul(i.cantidad) : new Decimal(0),
                    };
                  }),
                },
              }),
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

    let venta: Awaited<ReturnType<typeof crear>>;
    try {
      venta = await crear();
    } catch (e) {
      // Dos cobros simultáneos de la misma cita: el índice único de cita_id rechaza el segundo.
      const objetivo = e instanceof Prisma.PrismaClientKnownRequestError ? String((e.meta as { target?: unknown } | undefined)?.target ?? '') : '';
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && /cita_id|citaId/.test(objetivo)) {
        throw new ConflictException('Esta cita ya se cobró');
      }
      throw e;
    }

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

      // La cita cobrada con esta venta vuelve a quedar por cobrar (el índice único de cita_id la bloquearía).
      await tx.ventaLocalItem.updateMany({ where: { ventaId: id, citaId: { not: null } }, data: { citaId: null } });

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

  // ─── cobros de pedidos en el salón ───────────────────────────────────────────

  /**
   * Pagos aprobados que alguien cobró en el mostrador ("Cobrar y entregar" o "Cobrar" de pedidos): cuentan
   * en el corte igual que una venta local, cada uno en su método. Los pagos en línea (Mercado Pago) no entran:
   * ese dinero llega a la cuenta de Mercado Pago, no a la caja. Los pagos anteriores sin cobrado_por_id tampoco.
   */
  private async cobrosDelSalon(filtro: { cobradoPorId?: string; pagadoEn?: { gte?: Date; lte?: Date }; soloSinCorte?: boolean }) {
    const cobros = await this.prisma.pago.findMany({
      where: {
        estado: 'aprobado',
        metodo: { in: Object.keys(CAJA_POR_METODO_COBRO) },
        cobradoPorId: filtro.cobradoPorId ?? { not: null },
        ...(filtro.pagadoEn && { pagadoEn: filtro.pagadoEn }),
        ...(filtro.soloSinCorte && { corteId: null }),
      },
      select: { id: true, monto: true, metodo: true },
    });
    const suma = (caja: 'efectivo' | 'tarjeta' | 'transferencia') =>
      cobros.filter((c) => CAJA_POR_METODO_COBRO[c.metodo] === caja).reduce((acc, c) => acc.add(c.monto), new Decimal(0));
    return {
      ids: cobros.map((c) => c.id),
      total: cobros.reduce((acc, c) => acc.add(c.monto), new Decimal(0)),
      efectivo: suma('efectivo'),
      tarjeta: suma('tarjeta'),
      transferencia: suma('transferencia'),
    };
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
    const cobros = await this.cobrosDelSalon(
      where.creadoEn ? { pagadoEn: where.creadoEn as { gte?: Date; lte?: Date } } : {},
    );

    return {
      success: true,
      data: {
        totalVentas: totalVentas + cobros.ids.length,
        totalMonto: totalMonto.add(cobros.total),
        porMetodo: {
          efectivo: totalEfectivo.add(cobros.efectivo),
          tarjeta: totalTarjeta.add(cobros.tarjeta),
          transferencia: totalTransferencia.add(cobros.transferencia),
          mixto: totalMixto,
        },
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
      select: { id: true, total: true, metodoPago: true, montoEfectivo: true, montoTarjeta: true, montoTransferencia: true },
    });

    // Cobros de pedidos en el salón de esta cajera ese día, todavía sin corte.
    const cobros = await this.cobrosDelSalon({ cobradoPorId: cajeroId, pagadoEn: { gte: inicioDia, lte: finDia }, soloSinCorte: true });

    const totalVentas        = ventas.reduce((acc, v) => acc.add(v.total), new Decimal(0)).add(cobros.total);
    // Cada venta suma a su método; una mixta reparte su total según los montos que se registraron al cobrar.
    const porMetodo = (metodo: 'efectivo' | 'tarjeta' | 'transferencia', campoMixto: 'montoEfectivo' | 'montoTarjeta' | 'montoTransferencia') =>
      ventas.reduce((acc, v) => {
        if (v.metodoPago === metodo) return acc.add(v.total);
        if (v.metodoPago === 'mixto' && v[campoMixto] != null) return acc.add(v[campoMixto] as Decimal);
        return acc;
      }, new Decimal(0));
    const totalEfectivo      = porMetodo('efectivo', 'montoEfectivo').add(cobros.efectivo);
    const totalTarjeta       = porMetodo('tarjeta', 'montoTarjeta').add(cobros.tarjeta);
    const totalTransferencia = porMetodo('transferencia', 'montoTransferencia').add(cobros.transferencia);
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

      if (cobros.ids.length > 0) {
        // Solo los que siguen sin corte: si otro corte simultáneo se llevó alguno, este se revierte.
        const ligados = await tx.pago.updateMany({ where: { id: { in: cobros.ids }, corteId: null }, data: { corteId: nuevo.id } });
        if (ligados.count !== cobros.ids.length) {
          throw new ConflictException('Algunos cobros ya entraron en otro corte. Vuelve a registrar el corte.');
        }
      }

      return nuevo;
    });

    return { success: true, data: { ...corte, ventasVinculadas: ventas.length, cobrosVinculados: cobros.ids.length } };
  }
}
