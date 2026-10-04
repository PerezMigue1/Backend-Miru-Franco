import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'mixto'] as const;

export class ItemVentaDto {
  // Un ítem es de producto (presentacionId) O de servicio (servicioId).
  // La validación de "exactamente uno" se hace en el service.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  presentacionId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;

  /**
   * Ya no se usa: el backend cobra siempre el precio de la base (producto_presentaciones.precio o
   * servicios.precio). Se acepta para no romper clientes viejos, pero se ignora.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precioUnitario?: number;

  /** Cita finalizada que se cobra con esta línea de servicio (una cita se cobra una sola vez). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  citaId?: number;

  /** Personal que participó en el servicio (además de la especialista de la cita). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  participantes?: string[];
}

/** Reparto de un pago mixto: la suma debe ser igual al total de la venta. */
export class PagosMixtosDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  efectivo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tarjeta?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  transferencia?: number;
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

  /** Único lugar para bajar el precio. Si es mayor a 0, motivoDescuento es obligatorio. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  descuento?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivoDescuento?: string;

  /** Solo con metodoPago 'mixto'. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PagosMixtosDto)
  pagos?: PagosMixtosDto;

  @IsOptional()
  @IsString()
  notas?: string;
}
