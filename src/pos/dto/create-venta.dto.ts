import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'mixto'] as const;

export class ItemVentaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;

  /** Si no se envía, se toma el precio actual de la presentación */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioUnitario?: number;
}

export class CreateVentaDto {
  @IsIn(METODOS_PAGO)
  metodoPago: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemVentaDto)
  items: ItemVentaDto[];

  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  descuento?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}
