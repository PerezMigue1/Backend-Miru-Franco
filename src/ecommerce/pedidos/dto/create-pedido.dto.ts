import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
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

  @IsUUID()
  @IsOptional()
  direccionEnvioId?: string | null;

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
