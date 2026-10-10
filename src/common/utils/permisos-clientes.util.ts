import { PrismaService } from '../../prisma/prisma.service';

/**
 * Único criterio para "personal que puede ver datos de una clienta ajena
 * (perfil, quejas, notificaciones, direcciones)": admin, o quien tenga
 * `clientes:lectura` — mismo permiso que ya abre GET /clientes/:id.
 * Reutilizado en QuejasService, NotificacionesService y
 * DireccionesUsuarioService para no repetir la condición en cada uno —
 * si el criterio cambia, cambia en un solo lugar. Mismo mecanismo que
 * `puedeVerPedidosDeOtros`, en `common/` en vez de `ecommerce/common/`
 * porque QuejasService no es parte del módulo ecommerce.
 *
 * El permiso es sobre CLIENTAS: la persona consultada debe tener rol 'cliente'
 * (con `clientes:lectura` no se leen los datos de otros empleados ni del admin).
 * Uno mismo y el admin, siempre.
 */
export async function puedeVerDatosDeClientes(
  prisma: PrismaService,
  rol: string | null,
  consultadoId: string,
  solicitanteId?: string,
): Promise<boolean> {
  if (rol === 'admin') return true;
  if (solicitanteId && consultadoId === solicitanteId) return true;
  if (!rol) return false;
  const permisoRol = await prisma.permisoRol.findUnique({
    where: { rol },
    select: { claves: true },
  });
  if (!permisoRol?.claves.includes('clientes:lectura')) return false;
  const consultado = await prisma.usuario.findUnique({
    where: { id: consultadoId },
    select: { rol: true },
  });
  return consultado?.rol === 'cliente';
}
