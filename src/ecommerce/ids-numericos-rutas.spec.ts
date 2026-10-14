import { ParseIntPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';

/**
 * Un id no numérico en la ruta responde 400 "Id inválido" (ParseIntPipe + HttpExceptionFilter), no
 * 500 por Number('abc') === NaN en Prisma.
 */

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
/* eslint-disable @typescript-eslint/no-require-imports */
const { ServiciosController } = require('../servicios/servicios.controller');
const { ProveedoresController } = require('../proveedores/proveedores.controller');
const { ComprasController } = require('../compras/compras.controller');
const { CarritoController } = require('./carrito/carrito.controller');
const { EnviosController } = require('./envios/envios.controller');
const { FacturasController } = require('./facturas/facturas.controller');
const { HistorialEstadoPedidoController } = require('./historial-estado-pedido/historial-estado-pedido.controller');
const { PedidoItemsController } = require('./pedido-items/pedido-items.controller');
const { ValoracionesController } = require('./valoraciones/valoraciones.controller');
const { PedidosController } = require('./pedidos/pedidos.controller');
const { AsistenciaController } = require('../asistencia/asistencia.controller');
const { SolicitudesPermisoController } = require('../solicitudes-permiso/solicitudes-permiso.controller');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Pipes de un @Param(nombre) de un método del controlador. */
function pipesDe(controlador: any, metodo: string, nombre: string): unknown[] {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controlador, metodo) ?? {};
  const param = Object.entries(args).find(([k, v]: [string, any]) => k.startsWith(`${RouteParamtypes.PARAM}:`) && v.data === nombre);
  if (!param) throw new Error(`${controlador.name}.${metodo} no tiene @Param('${nombre}')`);
  return (param[1] as any).pipes ?? [];
}

const RUTAS: [any, string, string][] = [
  [ServiciosController, 'obtenerPorId', 'id'],
  [ServiciosController, 'actualizar', 'id'],
  [ServiciosController, 'eliminar', 'id'],
  [ProveedoresController, 'obtenerPorId', 'id'],
  [ProveedoresController, 'actualizar', 'id'],
  [ProveedoresController, 'eliminar', 'id'],
  [ComprasController, 'obtenerPorId', 'id'],
  [CarritoController, 'obtener', 'id'],
  [CarritoController, 'actualizar', 'id'],
  [CarritoController, 'eliminar', 'id'],
  [EnviosController, 'listarPorPedido', 'pedidoId'],
  [EnviosController, 'obtener', 'id'],
  [EnviosController, 'actualizar', 'id'],
  [EnviosController, 'eliminar', 'id'],
  [FacturasController, 'listarPorPedido', 'pedidoId'],
  [FacturasController, 'obtener', 'id'],
  [FacturasController, 'actualizar', 'id'],
  [FacturasController, 'eliminar', 'id'],
  [HistorialEstadoPedidoController, 'listarPorPedido', 'pedidoId'],
  [HistorialEstadoPedidoController, 'obtener', 'id'],
  [PedidoItemsController, 'listar', 'pedidoId'],
  [PedidoItemsController, 'crear', 'pedidoId'],
  [PedidoItemsController, 'actualizar', 'pedidoId'],
  [PedidoItemsController, 'actualizar', 'itemId'],
  [PedidoItemsController, 'eliminar', 'pedidoId'],
  [PedidoItemsController, 'eliminar', 'itemId'],
  [ValoracionesController, 'listarPorProducto', 'productoId'],
  [ValoracionesController, 'listarPorPedido', 'pedidoId'],
  [ValoracionesController, 'obtener', 'id'],
  [ValoracionesController, 'actualizar', 'id'],
  [ValoracionesController, 'eliminar', 'id'],
  [PedidosController, 'obtener', 'id'],
  [PedidosController, 'actualizar', 'id'],
  [PedidosController, 'eliminar', 'id'],
  [AsistenciaController, 'corregir', 'id'],
  [SolicitudesPermisoController, 'resolver', 'id'],
];

describe('Ids numéricos en la ruta', () => {
  it.each(RUTAS.map(([c, m, p]) => [`${c.name}.${m}(:${p})`, c, m, p]))('%s usa ParseIntPipe', (_ruta, controlador, metodo, nombre) => {
    const pipes = pipesDe(controlador, metodo as string, nombre as string);
    expect(pipes.some((p) => p === ParseIntPipe || p instanceof ParseIntPipe)).toBe(true);
  });
});
