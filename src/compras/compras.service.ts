import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventarioService } from '../inventario/inventario.service';
import { CreateCompraDto } from './dto/create-compra.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging } from '../common/utils/security.util';

@Injectable()
export class ComprasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventarioService: InventarioService,
  ) {}

  private incluirRelaciones() {
    return {
      proveedor: { select: { id: true, nombre: true } },
      usuario: { select: { id: true, nombre: true } },
      items: {
        include: {
          presentacion: {
            select: { id: true, tamanio: true, producto: { select: { id: true, nombre: true } } },
          },
        },
      },
    } as const;
  }

  async listar() {
    const compras = await this.prisma.compra.findMany({
      include: this.incluirRelaciones(),
      orderBy: { fecha: 'desc' },
    });

    return {
      success: true,
      count: compras.length,
      data: compras,
    };
  }

  async obtenerPorId(id: number) {
    const compra = await this.prisma.compra.findUnique({
      where: { id },
      include: this.incluirRelaciones(),
    });

    if (!compra) {
      throw new NotFoundException('Compra no encontrada');
    }

    return {
      success: true,
      data: compra,
    };
  }

  /**
   * Crea la compra + sus líneas + las entradas de inventario correspondientes + actualiza
   * el proveedor, todo en una sola transacción atómica. Si cualquier paso falla (ej. una
   * presentación no existe), Prisma revierte TODO: nunca queda una compra sin su stock
   * reflejado, ni un movimiento de inventario sin su compra de origen.
   */
  async crear(dto: CreateCompraDto, usuarioId: string) {
    const notasSanitizadas = dto.notas ? sanitizeInput(dto.notas) : null;
    if (notasSanitizadas && containsSQLInjection(notasSanitizadas)) {
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    const proveedor = await this.prisma.proveedor.findUnique({ where: { id: dto.proveedorId } });
    if (!proveedor || !proveedor.activo) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    const fecha = dto.fecha ? new Date(dto.fecha) : new Date();
    const total = dto.items.reduce((acc, item) => acc + item.cantidad * item.costoUnitario, 0);

    const compra = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.compra.create({
        data: {
          proveedorId: dto.proveedorId,
          usuarioId,
          fecha,
          total,
          notas: notasSanitizadas,
          items: {
            create: dto.items.map((item) => ({
              presentacionId: item.presentacionId,
              cantidad: item.cantidad,
              costoUnitario: item.costoUnitario,
              subtotal: item.cantidad * item.costoUnitario,
            })),
          },
        },
      });

      for (const item of dto.items) {
        await this.inventarioService.registrarEntrada(
          {
            presentacionId: item.presentacionId,
            cantidad: item.cantidad,
            motivo: 'Compra a proveedor',
            referenciaTipo: 'compra',
            referenciaId: String(creada.id),
          },
          usuarioId,
          tx,
        );
      }

      await tx.proveedor.update({
        where: { id: dto.proveedorId },
        data: { compras: { increment: 1 }, ultimaCompra: fecha },
      });

      return tx.compra.findUnique({
        where: { id: creada.id },
        include: this.incluirRelaciones(),
      });
    });

    console.log('✅ Compra registrada:', sanitizeForLogging({ id: compra?.id, proveedorId: dto.proveedorId, items: dto.items.length }));

    return {
      success: true,
      message: 'Compra registrada correctamente',
      data: compra,
    };
  }
}
