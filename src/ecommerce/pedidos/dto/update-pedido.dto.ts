import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { EstadoPedido } from '@prisma/client';

export class UpdatePedidoDto {
  @IsEnum(EstadoPedido)
  @IsOptional()
  estado?: EstadoPedido;

  @IsUUID()
  @IsOptional()
  direccionEnvioId?: string | null;

  @IsString()
  @IsOptional()
  direccionTextoCompleta?: string | null;

  @IsString()
  @IsOptional()
  notasCliente?: string | null;

  @IsString()
  @IsOptional()
  moneda?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  costoEnvio?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  impuestos?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  descuento?: number;

  @IsString()
  @IsOptional()
  metodoPago?: string | null;

  @IsString()
  @IsOptional()
  referenciaPago?: string | null;
}
