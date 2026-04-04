import { Module } from '@nestjs/common';
import { EcommerceAccessService } from './common/ecommerce-access.service';
import { DireccionesUsuarioController } from './direcciones-usuario/direcciones-usuario.controller';
import { DireccionesUsuarioService } from './direcciones-usuario/direcciones-usuario.service';
import { PedidosController } from './pedidos/pedidos.controller';
import { PedidosService } from './pedidos/pedidos.service';
import { PedidoItemsController } from './pedido-items/pedido-items.controller';
import { PedidoItemsService } from './pedido-items/pedido-items.service';
import { CarritoController } from './carrito/carrito.controller';
import { CarritoService } from './carrito/carrito.service';
import { PagosController } from './pagos/pagos.controller';
import { PagosService } from './pagos/pagos.service';
import { HistorialEstadoPedidoController } from './historial-estado-pedido/historial-estado-pedido.controller';
import { HistorialEstadoPedidoService } from './historial-estado-pedido/historial-estado-pedido.service';
import { EnviosController } from './envios/envios.controller';
import { EnviosService } from './envios/envios.service';
import { FacturasController } from './facturas/facturas.controller';
import { FacturasService } from './facturas/facturas.service';
import { ValoracionesController } from './valoraciones/valoraciones.controller';
import { ValoracionesService } from './valoraciones/valoraciones.service';
import { DevolucionesController } from './devoluciones/devoluciones.controller';
import { DevolucionesService } from './devoluciones/devoluciones.service';
import { NotificacionesController } from './notificaciones/notificaciones.controller';
import { NotificacionesService } from './notificaciones/notificaciones.service';

@Module({
  controllers: [
    DireccionesUsuarioController,
    PedidoItemsController,
    PedidosController,
    CarritoController,
    PagosController,
    HistorialEstadoPedidoController,
    EnviosController,
    FacturasController,
    ValoracionesController,
    DevolucionesController,
    NotificacionesController,
  ],
  providers: [
    EcommerceAccessService,
    DireccionesUsuarioService,
    PedidosService,
    PedidoItemsService,
    CarritoService,
    PagosService,
    HistorialEstadoPedidoService,
    EnviosService,
    FacturasService,
    ValoracionesService,
    DevolucionesService,
    NotificacionesService,
  ],
  exports: [EcommerceAccessService],
})
export class EcommerceModule {}
