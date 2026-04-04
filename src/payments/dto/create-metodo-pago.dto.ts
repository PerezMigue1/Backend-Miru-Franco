import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { TipoTarjetaGuardada } from '@prisma/client';

export class CreateMetodoPagoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  proveedor: string;

  /** Token o id del método en la pasarela (Mercado Pago, Stripe, etc.). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  idExterno: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'ultimos4 debe ser exactamente 4 dígitos' })
  ultimos4: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  marca?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  bancoNombre?: string;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  expMes?: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  expAnio?: number;

  @IsEnum(TipoTarjetaGuardada)
  @IsOptional()
  tipoTarjeta?: TipoTarjetaGuardada;

  @IsBoolean()
  @IsOptional()
  esVirtual?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  etiqueta?: string;

  @IsBoolean()
  @IsOptional()
  esPredeterminada?: boolean;
}
