import { PrismaService } from '../../prisma/prisma.service';

/**
 * Único criterio para "personal que puede ver/gestionar pedidos y pagos ajenos":
 * admin, o quien tenga `caja:escritura` (cobro físico en el salón — la estilista
 * dueña marcando pedidos de sus clientas). Reutilizado en PedidosService
 * (listar/obtenerPorId/actualizar) y PagosService (listarPorPedido/obtenerPorId)
 * para no repetir la condición en cada service — si el criterio cambia, cambia
 * en un solo lugar.
 *
 * Consulta directa a `permisos_rol` (misma tabla que ya usa `EcommerceAccessService`,
 * sin tocarlo ni exigir un permiso nuevo en ningún controller — mismo mecanismo
 * ya usado en PagosService.assertPuedeGestionarPago).
 */
export async function puedeVerPedidosDeOtros(
  prisma: PrismaService,
  rol: string | null,
): Promise<boolean> {
  if (rol === 'admin') return true;
  if (!rol) return false;
  const permisoRol = await prisma.permisoRol.findUnique({
    where: { rol },
    select: { claves: true },
  });
  return !!permisoRol?.claves.includes('caja:escritura');
}
