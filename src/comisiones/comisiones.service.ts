import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarRangoFechas } from '../common/utils/fecha-rango.util';
import type { Solicitante } from '../common/utils/permisos-citas.util';
import { GuardarComisionDto } from './dto/guardar-comision.dto';

/** Personal que puede recibir comisiones (el admin no participa en servicios). */
const ROLES_PERSONAL = ['estilista', 'empleado', 'becario'];
const ETIQUETA_ROL: Record<string, string> = { estilista: 'Estilista', empleado: 'Auxiliar', becario: 'Becaria' };

const puedeConfigurar = (s: Solicitante) => !!s.claves && (s.claves.includes('*') || s.claves.includes('comisiones:configurar'));

/**
 * Comisiones fijas por servicio: la auxiliar gana un monto fijo por cada servicio en que participa
 * (por ejemplo $100 por nanoplastia), sin porcentajes. El monto se copia a la venta al cobrar.
 */
@Injectable()
export class ComisionesService {
  constructor(private readonly prisma: PrismaService) {}

  async listarServicios() {
    const servicios = await this.prisma.servicio.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, precio: true, comision: { select: { monto: true, activo: true } } },
      orderBy: { nombre: 'asc' },
    });
    const data = servicios.map((s) => ({
      servicioId: s.id,
      nombre: s.nombre,
      precio: Number(s.precio),
      comision: s.comision ? { monto: Number(s.comision.monto), activo: s.comision.activo } : null,
    }));
    return { success: true, count: data.length, data };
  }

  async guardarComision(servicioId: number, dto: GuardarComisionDto, usuarioId: string) {
    const servicio = await this.prisma.servicio.findUnique({ where: { id: servicioId }, select: { id: true } });
    if (!servicio) throw new NotFoundException(`Servicio ${servicioId} no encontrado`);
    const monto = new Decimal(dto.monto);
    const activo = dto.activo ?? true;
    const comision = await this.prisma.comisionServicio.upsert({
      where: { servicioId },
      create: { servicioId, monto, activo, actualizadoPorId: usuarioId },
      update: { monto, activo, actualizadoPorId: usuarioId },
    });
    return { success: true, data: { ...comision, monto: Number(comision.monto) } };
  }

  async eliminarComision(servicioId: number) {
    const r = await this.prisma.comisionServicio.deleteMany({ where: { servicioId } });
    if (r.count === 0) throw new NotFoundException('Ese servicio no tiene comisión');
    return { success: true };
  }

  async listarPersonal() {
    const personal = await this.prisma.usuario.findMany({
      where: { activo: true, rol: { in: ROLES_PERSONAL } },
      select: { id: true, nombre: true, rol: true, perfilEmpleado: { select: { recibeComisiones: true } } },
      orderBy: { nombre: 'asc' },
    });
    const data = personal.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, recibeComisiones: u.perfilEmpleado?.recibeComisiones ?? false }));
    return { success: true, count: data.length, data };
  }

  /** Interruptor por persona. Si no tiene perfil de empleada, se crea con el puesto según su rol. */
  async cambiarRecibeComisiones(usuarioId: string, recibeComisiones: boolean) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, rol: true, activo: true } });
    if (!usuario || !usuario.activo) throw new NotFoundException('Persona no encontrada o inactiva');
    if (!ROLES_PERSONAL.includes(usuario.rol)) throw new BadRequestException('Solo el personal del salón recibe comisiones');
    const perfil = await this.prisma.perfilEmpleado.upsert({
      where: { usuarioId },
      create: { usuarioId, puesto: ETIQUETA_ROL[usuario.rol] ?? 'Personal', recibeComisiones },
      update: { recibeComisiones },
    });
    return { success: true, data: { usuarioId, recibeComisiones: perfil.recibeComisiones } };
  }

  /**
   * Comisiones ganadas en servicios cobrados (ventas pagadas) en el periodo. Con comisiones:configurar
   * se ve a todo el personal; con comisiones:ver_propias, solo lo propio.
   */
  async reporte(desde: string | undefined, hasta: string | undefined, solicitante: Solicitante) {
    const rango = normalizarRangoFechas(desde, hasta);
    const participaciones = await this.prisma.ventaItemParticipante.findMany({
      where: {
        ...(puedeConfigurar(solicitante) ? {} : { usuarioId: solicitante.id }),
        ventaItem: { venta: { estado: 'pagada', ...(rango.gte || rango.lte ? { creadoEn: rango } : {}) } },
      },
      select: {
        usuarioId: true,
        comisionMonto: true,
        usuario: { select: { nombre: true } },
        ventaItem: {
          select: {
            cantidad: true,
            servicio: { select: { nombre: true } },
            venta: { select: { folio: true, creadoEn: true } },
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    const porPersona = new Map<string, { usuarioId: string; nombre: string; totalComision: number; servicios: number; detalle: unknown[] }>();
    for (const p of participaciones) {
      const fila = porPersona.get(p.usuarioId) ?? { usuarioId: p.usuarioId, nombre: p.usuario.nombre, totalComision: 0, servicios: 0, detalle: [] };
      const monto = Number(p.comisionMonto);
      fila.totalComision = Math.round((fila.totalComision + monto) * 100) / 100;
      fila.servicios += p.ventaItem.cantidad;
      fila.detalle.push({
        fecha: p.ventaItem.venta.creadoEn,
        folio: p.ventaItem.venta.folio,
        servicio: p.ventaItem.servicio?.nombre ?? 'Servicio',
        comision: monto,
      });
      porPersona.set(p.usuarioId, fila);
    }
    const personas = [...porPersona.values()].sort((a, b) => b.totalComision - a.totalComision || a.nombre.localeCompare(b.nombre));
    const total = Math.round(personas.reduce((acc, p) => acc + p.totalComision, 0) * 100) / 100;
    return { success: true, data: { desde: desde ?? null, hasta: hasta ?? null, total, personas } };
  }
}
