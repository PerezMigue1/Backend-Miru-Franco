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
 * Con `clientes:lectura` solo se leen datos de usuarios con rol 'cliente': los
 * de otro miembro del personal (estilista, empleado, becario, admin) quedan
 * denegados aunque se tenga la clave. Uno mismo y el admin, siempre; sin la
 * clave (la clienta), nada ajeno.
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
  // La clave abre solo datos de clientas: si el consultado no existe o es
  // personal, se deniega antes de mirar los permisos del solicitante.
  const consultado = await prisma.usuario.findUnique({
    where: { id: consultadoId },
    select: { rol: true },
  });
  if (consultado?.rol !== 'cliente') return false;
  const permisoRol = await prisma.permisoRol.findUnique({
    where: { rol },
    select: { claves: true },
  });
  return !!permisoRol?.claves.includes('clientes:lectura');
}
