import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { EstadoPago } from '@prisma/client';

export class UpdatePagoDto {
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

  @IsDateString()
  @IsOptional()
  pagadoEn?: string | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto?: number;
}
