import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { containsSQLInjection, sanitizeInput } from '../common/utils/security.util';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import { ListCitasDto } from './dto/list-citas.dto';
import { ReprogramarCitaDto } from './dto/reprogramar-cita.dto';
import { CancelarCitaDto } from './dto/cancelar-cita.dto';
import { MaterialesCitaDto } from './dto/materiales-cita.dto';

const ROLES_ESPECIALISTA = ['estilista', 'empleado', 'becario'] as const;
const ESTADOS_FINALES = ['cancelada', 'completada', 'no_asistio'] as const;

@Injectable()
export class CitasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventarioService: InventarioService,
  ) {}

  // ─── helpers ────────────────────────────────────────────────────────────────

  private incluirRelaciones() {
    return {
      cliente:     { select: { id: true, nombre: true, email: true, telefono: true } },
      especialista: { select: { id: true, nombre: true, rol: true } },
      servicio:    { select: { id: true, nombre: true, duracionMinutos: true, precio: true } },
    } as const;
  }

  /**
   * Devuelve filtro WHERE de scope según el rol del solicitante.
   * Clientes solo ven sus propias citas. Staff (estilista/empleado/becario) y
   * admin ven todas las citas del salón — pueden acotar por especialista vía
   * el query param `especialistaId` (ver `listar`/`listarDia`/`listarCalendario`).
   */
  private aplicarScope(usuarioId: string, rolUsuario?: string): Record<string, unknown> {
    if (rolUsuario === 'cliente') return { clienteId: usuarioId };
    return {};
  }

  /** Valida que no haya solapamiento de horario para el especialista. */
  private async validarSolapamiento(
    especialistaId: string,
    inicio: Date,
    fin: Date,
    excluirId?: number,
  ) {
    const where: Record<string, unknown> = {
      especialistaId,
      estado: { in: ['pendiente', 'confirmada', 'en_curso'] },
      fechaHoraInicio: { lt: fin },
      fechaHoraFin:    { gt: inicio },
    };
    if (excluirId) where.id = { not: excluirId };

    const solapamiento = await this.prisma.cita.findFirst({ where });
    if (solapamiento) {
      throw new BadRequestException(
        `El especialista ya tiene una cita en ese horario (cita #${solapamiento.id})`,
      );
    }
  }

  // ─── lecturas ────────────────────────────────────────────────────────────────

  async listar(query: ListCitasDto, usuarioId: string, rolUsuario?: string) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = { ...this.aplicarScope(usuarioId, rolUsuario) };
    if (query.estado)        where.estado        = query.estado;
    if (query.especialistaId) where.especialistaId = query.especialistaId;
    if (query.clienteId)     where.clienteId     = query.clienteId;
    if (query.desde || query.hasta) {
      const rango: Record<string, Date> = {};
      if (query.desde) rango.gte = new Date(query.desde);
      if (query.hasta) rango.lte = new Date(query.hasta);
      where.fechaHoraInicio = rango;
    }

    const orderBy =
      query.orden === 'creadoEn'
        ? { creadoEn: 'desc' as const }
        : { fechaHoraInicio: 'asc' as const };

    const [total, citas] = await this.prisma.$transaction([
      this.prisma.cita.count({ where }),
      this.prisma.cita.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.incluirRelaciones(),
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: citas,
    };
  }

  async listarDia(fecha: string, usuarioId: string, rolUsuario?: string, especialistaId?: string) {
    if (!fecha) throw new BadRequestException('El parámetro fecha es requerido (YYYY-MM-DD)');
    const dia = new Date(fecha);
    if (isNaN(dia.getTime())) throw new BadRequestException('Fecha inválida');

    const inicio = new Date(fecha + 'T00:00:00.000Z');
    const fin    = new Date(fecha + 'T23:59:59.999Z');

    const citas = await this.prisma.cita.findMany({
      where: {
        ...this.aplicarScope(usuarioId, rolUsuario),
        ...(especialistaId ? { especialistaId } : {}),
        fechaHoraInicio: { gte: inicio, lte: fin },
      },
      orderBy: { fechaHoraInicio: 'asc' },
      include: this.incluirRelaciones(),
    });

    return { success: true, count: citas.length, data: citas };
  }

  async listarCalendario(desde: string, hasta: string, usuarioId: string, rolUsuario?: string, especialistaId?: string) {
    if (!desde || !hasta) {
      throw new BadRequestException('Los parámetros desde y hasta son requeridos');
    }
    const fechaDesde = new Date(desde);
    const fechaHasta = new Date(hasta);
    if (isNaN(fechaDesde.getTime()) || isNaN(fechaHasta.getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }

    const citas = await this.prisma.cita.findMany({
      where: {
        ...this.aplicarScope(usuarioId, rolUsuario),
        ...(especialistaId ? { especialistaId } : {}),
        fechaHoraInicio: { gte: fechaDesde, lte: fechaHasta },
      },
      orderBy: { fechaHoraInicio: 'asc' },
      include: this.incluirRelaciones(),
    });

    return { success: true, count: citas.length, data: citas };
  }

  async obtener(id: number, usuarioId: string, rolUsuario?: string) {
    const cita = await this.prisma.cita.findUnique({
      where: { id },
      include: this.incluirRelaciones(),
    });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);

    if (rolUsuario === 'cliente' && cita.clienteId !== usuarioId) {
      throw new ForbiddenException('No tienes acceso a esta cita');
    }

    return { success: true, data: cita };
  }

  // ─── escrituras ──────────────────────────────────────────────────────────────

  async crear(dto: CreateCitaDto, solicitanteId: string, rolUsuario?: string) {
    // Si el solicitante es cliente, se ignora el clienteId del DTO y se usa el propio
    const clienteId = rolUsuario === 'cliente' ? solicitanteId : dto.clienteId;

    // Validar especialista
    const especialista = await this.prisma.usuario.findUnique({
      where: { id: dto.especialistaId },
      select: { id: true, rol: true, activo: true },
    });
    if (!especialista || !especialista.activo) {
      throw new NotFoundException('Especialista no encontrado o inactivo');
    }
    if (!ROLES_ESPECIALISTA.includes(especialista.rol as any)) {
      throw new BadRequestException(
        `El usuario asignado no es un especialista válido (roles válidos: ${ROLES_ESPECIALISTA.join(', ')})`,
      );
    }

    // Validar cliente
    const cliente = await this.prisma.usuario.findUnique({
      where: { id: clienteId },
      select: { id: true, activo: true },
    });
    if (!cliente || !cliente.activo) throw new NotFoundException('Cliente no encontrado o inactivo');

    // Validar servicio
    const servicio = await this.prisma.servicio.findUnique({
      where: { id: dto.servicioId },
      select: { id: true, activo: true },
    });
    if (!servicio || !servicio.activo) throw new NotFoundException('Servicio no encontrado o inactivo');

    const fechaHoraInicio = new Date(dto.fechaHoraInicio);
    const fechaHoraFin    = new Date(dto.fechaHoraFin);
    if (fechaHoraFin <= fechaHoraInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
    }

    await this.validarSolapamiento(dto.especialistaId, fechaHoraInicio, fechaHoraFin);

    const notas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notas && containsSQLInjection(notas)) {
      throw new BadRequestException('Las notas contienen caracteres no permitidos');
    }

    const cita = await this.prisma.cita.create({
      data: { clienteId, especialistaId: dto.especialistaId, servicioId: dto.servicioId, fechaHoraInicio, fechaHoraFin, notas },
      include: this.incluirRelaciones(),
    });

    return { success: true, data: cita };
  }

  async actualizar(id: number, dto: UpdateCitaDto) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);

    const data: Record<string, unknown> = {};

    if (dto.especialistaId !== undefined) {
      const esp = await this.prisma.usuario.findUnique({
        where: { id: dto.especialistaId },
        select: { id: true, rol: true, activo: true },
      });
      if (!esp || !esp.activo) throw new NotFoundException('Especialista no encontrado');
      if (!ROLES_ESPECIALISTA.includes(esp.rol as any)) {
        throw new BadRequestException('El usuario asignado no es un especialista válido');
      }
      data.especialistaId = dto.especialistaId;
    }
    if (dto.servicioId !== undefined) data.servicioId = dto.servicioId;
    if (dto.estado     !== undefined) data.estado     = dto.estado;
    if (dto.notas      !== undefined) {
      const notasLimpias = sanitizeInput(dto.notas);
      if (containsSQLInjection(notasLimpias)) throw new BadRequestException('Notas inválidas');
      data.notas = notasLimpias;
    }

    if (dto.fechaHoraInicio !== undefined || dto.fechaHoraFin !== undefined) {
      const nuevaInicio     = dto.fechaHoraInicio ? new Date(dto.fechaHoraInicio) : cita.fechaHoraInicio;
      const nuevaFin        = dto.fechaHoraFin    ? new Date(dto.fechaHoraFin)    : cita.fechaHoraFin;
      if (nuevaFin <= nuevaInicio) throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
      const especialistaId = (dto.especialistaId ?? cita.especialistaId) as string;
      await this.validarSolapamiento(especialistaId, nuevaInicio, nuevaFin, id);
      data.fechaHoraInicio = nuevaInicio;
      data.fechaHoraFin    = nuevaFin;
    }

    const actualizada = await this.prisma.cita.update({ where: { id }, data, include: this.incluirRelaciones() });
    return { success: true, data: actualizada };
  }

  async checkIn(id: number) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    if (!['pendiente', 'confirmada'].includes(cita.estado)) {
      throw new BadRequestException(`No se puede hacer check-in en estado '${cita.estado}'`);
    }
    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'en_curso' },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  async checkOut(id: number) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    if (cita.estado !== 'en_curso') {
      throw new BadRequestException(`Solo se puede hacer check-out de citas en estado 'en_curso'`);
    }
    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'completada' },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  async reprogramar(id: number, dto: ReprogramarCitaDto) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    if (ESTADOS_FINALES.includes(cita.estado as any)) {
      throw new BadRequestException(`No se puede reprogramar una cita en estado '${cita.estado}'`);
    }

    const fechaHoraInicio = new Date(dto.fechaHoraInicio);
    const fechaHoraFin    = new Date(dto.fechaHoraFin);
    if (fechaHoraFin <= fechaHoraInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la de inicio');
    }

    await this.validarSolapamiento(cita.especialistaId, fechaHoraInicio, fechaHoraFin, id);

    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: {
        fechaHoraInicio,
        fechaHoraFin,
        estado: 'reprogramada',
        notas: dto.notas !== undefined ? sanitizeInput(dto.notas) : cita.notas,
      },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  async cancelar(id: number, dto: CancelarCitaDto) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    if (ESTADOS_FINALES.includes(cita.estado as any)) {
      throw new BadRequestException(`No se puede cancelar una cita en estado '${cita.estado}'`);
    }

    const motivoLimpio = sanitizeInput(dto.motivoCancelacion);
    if (containsSQLInjection(motivoLimpio)) {
      throw new BadRequestException('El motivo contiene caracteres no permitidos');
    }

    const actualizada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'cancelada', motivoCancelacion: motivoLimpio },
      include: this.incluirRelaciones(),
    });
    return { success: true, data: actualizada };
  }

  async registrarMateriales(id: number, dto: MaterialesCitaDto, usuarioId: string) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException(`Cita ${id} no encontrada`);
    if (!['en_curso', 'completada'].includes(cita.estado)) {
      throw new BadRequestException(
        'Solo se pueden registrar materiales en citas en_curso o completadas',
      );
    }

    // Todas las salidas en una sola transacción: si una falla (stock insuficiente),
    // no queda inventario parcialmente descontado.
    const resultados = await this.prisma.$transaction(async (tx) => {
      const acc = [];
      for (const material of dto.materiales) {
        const res = await this.inventarioService.registrarSalida(
          {
            presentacionId: material.presentacionId,
            cantidad:       material.cantidad,
            motivo:         'uso en cita',
            referenciaTipo: 'cita',
            referenciaId:   cita.id.toString(),
          },
          usuarioId,
          tx,
        );
        acc.push(res.data);
      }
      return acc;
    });

    return { success: true, count: resultados.length, data: resultados };
  }
}
