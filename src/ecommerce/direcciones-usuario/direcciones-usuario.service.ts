import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceAccessService } from '../common/ecommerce-access.service';
import { puedeVerDatosDeClientes } from '../../common/utils/permisos-clientes.util';
import { CreateDireccionUsuarioDto } from './dto/create-direccion-usuario.dto';
import { UpdateDireccionUsuarioDto } from './dto/update-direccion-usuario.dto';

@Injectable()
export class DireccionesUsuarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EcommerceAccessService,
  ) {}

  /**
   * Lista direcciones del usuario autenticado.
   * Admin, o staff con `clientes:lectura`, puede pasar `usuarioId` en query
   * para ver las de otro usuario (ficha de cliente en operación).
   */
  async listar(solicitanteId: string, filtroUsuarioId?: string) {
    const rol = await this.access.getRol(solicitanteId);
    let targetUserId = solicitanteId;
    if (filtroUsuarioId) {
      if (!(await puedeVerDatosDeClientes(this.prisma, rol))) {
        throw new ForbiddenException(
          'No tienes permiso para listar direcciones de otro usuario',
        );
      }
      targetUserId = filtroUsuarioId;
    }

    const data = await this.prisma.direccionUsuario.findMany({
      where: { usuarioId: targetUserId },
      orderBy: { creadoEn: 'desc' },
    });
    return { success: true, count: data.length, data };
  }

  async obtenerPorId(id: string, solicitanteId: string) {
    await this.access.assertDireccionUsuario(solicitanteId, id);
    const data = await this.prisma.direccionUsuario.findUnique({
      where: { id },
    });
    if (!data) throw new NotFoundException('Dirección no encontrada');
    return { success: true, data };
  }

  async crear(solicitanteId: string, dto: CreateDireccionUsuarioDto) {
    const usuarioId = solicitanteId;

    if (dto.esPrincipal) {
      await this.prisma.direccionUsuario.updateMany({
        where: { usuarioId },
        data: { esPrincipal: false },
      });
    }

    const data = await this.prisma.direccionUsuario.create({
      data: {
        usuarioId,
        calle: dto.calle,
        codigoPostal: dto.codigoPostal,
        estado: dto.estado,
        municipioAlcaldia: dto.municipioAlcaldia,
        localidad: dto.localidad,
        coloniaBarrio: dto.coloniaBarrio,
        numeroInterior: dto.numeroInterior ?? null,
        indicaciones: dto.indicaciones ?? null,
        tipoDomicilio: dto.tipoDomicilio,
        contactoNombreApellido: dto.contactoNombreApellido,
        contactoTelefono: dto.contactoTelefono,
        esPrincipal: dto.esPrincipal ?? false,
      },
    });
    return { success: true, data };
  }

  async actualizar(
    id: string,
    solicitanteId: string,
    dto: UpdateDireccionUsuarioDto,
  ) {
    await this.access.assertDireccionUsuario(solicitanteId, id);
    const actual = await this.prisma.direccionUsuario.findUnique({
      where: { id },
    });
    if (!actual) throw new NotFoundException('Dirección no encontrada');

    if (dto.esPrincipal === true) {
      await this.prisma.direccionUsuario.updateMany({
        where: { usuarioId: actual.usuarioId, id: { not: id } },
        data: { esPrincipal: false },
      });
    }

    const data = await this.prisma.direccionUsuario.update({
      where: { id },
      data: {
        ...(dto.calle !== undefined && { calle: dto.calle }),
        ...(dto.codigoPostal !== undefined && { codigoPostal: dto.codigoPostal }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.municipioAlcaldia !== undefined && {
          municipioAlcaldia: dto.municipioAlcaldia,
        }),
        ...(dto.localidad !== undefined && { localidad: dto.localidad }),
        ...(dto.coloniaBarrio !== undefined && {
          coloniaBarrio: dto.coloniaBarrio,
        }),
        ...(dto.numeroInterior !== undefined && {
          numeroInterior: dto.numeroInterior,
        }),
        ...(dto.indicaciones !== undefined && { indicaciones: dto.indicaciones }),
        ...(dto.tipoDomicilio !== undefined && {
          tipoDomicilio: dto.tipoDomicilio,
        }),
        ...(dto.contactoNombreApellido !== undefined && {
          contactoNombreApellido: dto.contactoNombreApellido,
        }),
        ...(dto.contactoTelefono !== undefined && {
          contactoTelefono: dto.contactoTelefono,
        }),
        ...(dto.esPrincipal !== undefined && { esPrincipal: dto.esPrincipal }),
      },
    });
    return { success: true, data };
  }

  async eliminar(id: string, solicitanteId: string) {
    await this.access.assertDireccionUsuario(solicitanteId, id);
    await this.prisma.direccionUsuario.delete({ where: { id } });
    return { success: true, message: 'Dirección eliminada' };
  }
}
