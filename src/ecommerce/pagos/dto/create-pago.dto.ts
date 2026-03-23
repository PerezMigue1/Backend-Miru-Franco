import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { EstadoPago } from '@prisma/client';

export class CreatePagoDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

  @IsInt()
  @Min(1)
  intentoNumero: number;

  @IsNumber()
  @Min(0)
  monto: number;

  @IsString()
  @IsOptional()
  moneda?: string;

  @IsString()
  metodo: string;

  @IsString()
  @IsOptional()
  proveedor?: string | null;

  @IsEnum(EstadoPago)
  @IsOptional()
  estado?: EstadoPago;

  @IsString()
  @IsOptional()
  referenciaExterna?: string | null;

  @IsString()
  @IsOptional()
  errorMensaje?: string | null;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}
