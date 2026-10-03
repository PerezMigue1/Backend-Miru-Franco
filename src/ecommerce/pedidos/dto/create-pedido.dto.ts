import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoPedido } from '@prisma/client';
import { PedidoItemLineDto } from './pedido-item-line.dto';

export class CreatePedidoDto {
  /** Solo admin puede fijar otro usuario */
  @IsUUID()
  @IsOptional()
  usuarioId?: string;

  /** Ya no hay envío a domicilio: el servicio rechaza cualquier dirección. */
  @IsUUID()
  @IsOptional()
  direccionEnvioId?: string | null;

  /** Solo se acepta 0: el servicio rechaza un costo de envío mayor. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  costoEnvio?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'El pedido debe incluir al menos un ítem' })
  @ValidateNested({ each: true })
  @Type(() => PedidoItemLineDto)
  items: PedidoItemLineDto[];

  @IsEnum(EstadoPedido)
  @IsOptional()
  estado?: EstadoPedido;

  @IsString()
  @IsOptional()
  notasCliente?: string;

  @IsString()
  @IsOptional()
  moneda?: string;

  @IsString()
  @IsOptional()
  metodoPago?: string;

  @IsString()
  @IsOptional()
  referenciaPago?: string;
}
