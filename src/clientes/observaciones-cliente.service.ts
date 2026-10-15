import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SolicitanteObservacion {
  id: string;
  rol: string | null;
}

const SELECCION = {
  id: true,
  texto: true,
  creadoEn: true,
  autor: { select: { id: true, nombre: true } },
} as const;

/**
 * Observaciones del CRM (tabla observaciones_cliente). Misma regla que puedeVerDatosDeClientes:
 * con la clave de clientes solo se anota sobre usuarias con rol cliente; el admin, sobre cualquiera.
 */
@Injectable()
export class ObservacionesClienteService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(clienteId: string, solicitante: SolicitanteObservacion) {
    await this.verificarAcceso(clienteId, solicitante);
    const data = await this.prisma.observacionCliente.findMany({
      where: { clienteId },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      select: SELECCION,
    });
    return { success: true, count: data.length, data };
  }

  async crear(clienteId: string, texto: string, solicitante: SolicitanteObservacion) {
    await this.verificarAcceso(clienteId, solicitante);
    const data = await this.prisma.observacionCliente.create({
      data: { clienteId, autorId: solicitante.id, texto },
      select: SELECCION,
    });
    return { success: true, data };
  }

  private async verificarAcceso(clienteId: string, solicitante: SolicitanteObservacion) {
    const cliente = await this.prisma.usuario.findUnique({
      where: { id: clienteId },
      select: { id: true, rol: true },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    if (solicitante.rol !== 'admin' && cliente.rol !== 'cliente') {
      throw new ForbiddenException('Solo puedes ver o agregar observaciones de clientas.');
    }
  }
}
