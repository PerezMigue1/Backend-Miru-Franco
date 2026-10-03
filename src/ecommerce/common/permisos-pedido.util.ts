import { PrismaService } from '../../prisma/prisma.service';

/** Permiso propio para preparar entregas: marcar listo para recoger, entregar y cobrar al entregar. */
export const PERMISO_ENTREGAR_PEDIDOS = 'pedidos:entregar';
/** Cobro en caja (incluye el resto de cambios de estado del personal). */
export const PERMISO_CAJA = 'caja:escritura';

/** Claves del rol en `permisos_rol`. El admin siempre tiene todo ('*'). */
async function clavesDeRol(prisma: PrismaService, rol: string | null): Promise<string[]> {
  if (rol === 'admin') return ['*'];
  if (!rol) return [];
  const permisoRol = await prisma.permisoRol.findUnique({ where: { rol }, select: { claves: true } });
  return permisoRol?.claves ?? [];
}

const tiene = (claves: string[], clave: string) => claves.includes('*') || claves.includes(clave);

/**
 * Personal que puede ver pedidos y pagos ajenos: admin, `caja:escritura` o `pedidos:entregar`
 * (quien entrega necesita ver la lista de "Pedidos por recoger"). Solo lectura: para cambiar estados
 * se usa `puedeGestionarPedidos` o `puedeEntregarPedidos`.
 */
export async function puedeVerPedidosDeOtros(prisma: PrismaService, rol: string | null): Promise<boolean> {
  const claves = await clavesDeRol(prisma, rol);
  return tiene(claves, PERMISO_CAJA) || tiene(claves, PERMISO_ENTREGAR_PEDIDOS);
}

/** Cambios de estado del personal por el PUT general (cobrar, preparar, cancelar): admin o caja. */
export async function puedeGestionarPedidos(prisma: PrismaService, rol: string | null): Promise<boolean> {
  return tiene(await clavesDeRol(prisma, rol), PERMISO_CAJA);
}

/** Marcar listo para recoger y entregar (con o sin cobro): admin o `pedidos:entregar`. */
export async function puedeEntregarPedidos(prisma: PrismaService, rol: string | null): Promise<boolean> {
  return tiene(await clavesDeRol(prisma, rol), PERMISO_ENTREGAR_PEDIDOS);
}
