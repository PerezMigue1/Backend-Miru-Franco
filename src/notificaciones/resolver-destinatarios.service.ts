import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CanalResuelto {
  canal: string;
  estado: 'pendiente' | 'descartada';
}

@Injectable()
export class ResolverDestinatariosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Para un usuario puntual (ya sabido por el listener: cliente/especialista de
   * la entidad), decide el estado inicial de cada canal deseado según
   * `preferencias_notificacion`. Sin fila de preferencia -> default enviar
   * ('pendiente'). Con fila activo=false -> 'descartada' (se registra el
   * envío para auditoría, no se despacha).
   */
  async resolverCanales(usuarioId: string, tipo: string, canalesDeseados: string[]): Promise<CanalResuelto[]> {
    if (canalesDeseados.length === 0) return [];
    const preferencias = await this.prisma.preferenciaNotificacion.findMany({
      where: { usuarioId, tipo, canal: { in: canalesDeseados } },
      select: { canal: true, activo: true },
    });
    const inactivos = new Set(preferencias.filter((p) => !p.activo).map((p) => p.canal));
    return canalesDeseados.map((canal) => ({
      canal,
      estado: inactivos.has(canal) ? 'descartada' : 'pendiente',
    }));
  }

  /**
   * Resuelve destinatarios de una notificación dirigida a un PERMISO (no a un
   * usuario puntual): todos los usuarios activos cuyo rol tiene la clave dada
   * en `permisos_rol`, más los usuarios con rol 'admin'.
   *
   * Distinción importante con `permisos-clientes.util.ts:17` y
   * `permisos-pedido.util.ts:19`: esos dos hacen `if (rol === 'admin') return
   * true` ANTES de consultar `permisos_rol` — un short-circuit que se salta la
   * consulta por completo cuando el rol es 'admin' (ese es el bug real de esos
   * dos archivos, se corrige en tarea aparte).
   *
   * Aquí NO pasa eso: la consulta a `permisos_rol` (líneas de abajo) SIEMPRE se
   * ejecuta, sin importar si 'admin' tiene o no fila propia en esa tabla.
   * `roles.add('admin')` es solo una inclusión defensiva agregada AL RESULTADO
   * de esa consulta —no un reemplazo de ella— para garantizar que el rol
   * 'admin' quede en el `WHERE rol IN (...)` final incluso si nunca se le dio
   * de alta una fila en `permisos_rol` (mismo caso que hace necesario el
   * short-circuit en los otros dos archivos, resuelto aquí sin saltarse nada).
   *
   * NOTA: ningún evento del bloque 5 (mínimo de esta etapa) usa este método —
   * cita.creada/cancelada y venta_local.pagada notifican a usuarios puntuales
   * (cliente/especialista), no a un permiso agregado. Queda listo para eventos
   * futuros dirigidos a staff (recordatorios, stock, caducidad).
   */
  async resolverUsuariosPorPermiso(clave: string): Promise<string[]> {
    const rolesConClave = await this.prisma.permisoRol.findMany({
      where: { claves: { has: clave } },
      select: { rol: true },
    });
    const roles = new Set(rolesConClave.map((r) => r.rol));
    roles.add('admin');
    const usuarios = await this.prisma.usuario.findMany({
      where: { rol: { in: [...roles] }, activo: true },
      select: { id: true },
    });
    return usuarios.map((u) => u.id);
  }
}
