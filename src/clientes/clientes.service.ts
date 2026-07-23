import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { containsSQLInjection, sanitizeInput, buildPhoneLookupCandidates } from '../common/utils/security.util';
import { BadRequestException } from '@nestjs/common';
import { ListClientesDto } from './dto/list-clientes.dto';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListClientesDto) {
    const page  = query.page  ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = { rol: 'cliente' };
    if (!query.incluirInactivos) where.activo = true;

    if (query.q?.trim()) {
      const q = sanitizeInput(query.q.trim());
      if (containsSQLInjection(q)) {
        throw new BadRequestException('Búsqueda contiene caracteres no permitidos');
      }
      where.OR = [
        { nombre: { contains: q, mode: 'insensitive' } },
        { email:  { contains: q, mode: 'insensitive' } },
        { telefono: { contains: q, mode: 'insensitive' } },
        // Variantes de teléfono (con/sin lada 52, con/sin "+") — cubre que la cajera
        // teclee "7712345678" y encuentre un cliente guardado como "+527712345678".
        // Vacío (búsquedas por nombre) no agrega nada al OR.
        ...buildPhoneLookupCandidates(q).map((tel) => ({ telefono: { contains: tel } })),
      ];
    }

    const [total, clientes] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        select: {
          id: true,
          nombre: true,
          email: true,
          telefono: true,
          foto: true,
          activo: true,
          confirmado: true,
          recibePromociones: true,
          creadoEn: true,
        },
      }),
    ]);

    return {
      success: true,
      count: total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: clientes,
    };
  }

  async obtener(id: string) {
    const cliente = await this.prisma.usuario.findFirst({
      where: { id, rol: 'cliente' },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        foto: true,
        activo: true,
        confirmado: true,
        recibePromociones: true,
        fechaNacimiento: true,
        tipoCabello: true,
        colorNatural: true,
        colorActual: true,
        productosUsados: true,
        alergias: true,
        creadoEn: true,
        actualizadoEn: true,
        _count: {
          select: { pedidos: true, quejas: true, seguimientos: true },
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente ${id} no encontrado`);
    }

    return { success: true, data: cliente };
  }

  async historialCompras(clienteId: string) {
    const existe = await this.prisma.usuario.findFirst({
      where: { id: clienteId, rol: 'cliente' },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException(`Cliente ${clienteId} no encontrado`);

    const pedidos = await this.prisma.pedido.findMany({
      where: { usuarioId: clienteId },
      orderBy: { creadoEn: 'desc' },
      include: {
        items: {
          include: {
            producto:     { select: { id: true, nombre: true, marca: true } },
            presentacion: { select: { id: true, tamanio: true } },
          },
        },
        pagos:  { select: { id: true, estado: true, monto: true, metodo: true, pagadoEn: true } },
        envios: { select: { id: true, estadoEnvio: true, numeroGuia: true, empresaEnvio: true } },
      },
    });

    return { success: true, count: pedidos.length, data: pedidos };
  }

  async historialCitas(clienteId: string) {
    const existe = await this.prisma.usuario.findFirst({
      where: { id: clienteId, rol: 'cliente' },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException(`Cliente ${clienteId} no encontrado`);

    const citas = await this.prisma.cita.findMany({
      where: { clienteId },
      orderBy: { fechaHoraInicio: 'desc' },
      include: {
        especialista: { select: { id: true, nombre: true, rol: true } },
        servicio:     { select: { id: true, nombre: true, duracionMinutos: true, precio: true } },
      },
    });

    return { success: true, count: citas.length, data: citas };
  }
}
