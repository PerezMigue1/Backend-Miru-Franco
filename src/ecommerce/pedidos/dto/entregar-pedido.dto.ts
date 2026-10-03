import { IsIn, IsOptional } from 'class-validator';
import { METODOS_COBRO_SALON, MetodoCobroSalon } from '../flujo-pedido';

/** Cómo se cobró en el mostrador; obligatorio solo para los pedidos de pago al recoger. */
export class EntregarPedidoDto {
  @IsOptional()
  @IsIn(METODOS_COBRO_SALON)
  metodoCobro?: MetodoCobroSalon;
}
