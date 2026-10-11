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
 * Con `clientes:lectura` se lee a cualquier persona (también a otro miembro del
 * personal), como en e26619d. Uno mismo y el admin, siempre; sin la clave (la
 * clienta), nada ajeno.
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
  return !!permisoRol?.claves.includes('clientes:lectura');
}
