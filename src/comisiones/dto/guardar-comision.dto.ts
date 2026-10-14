import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Monto fijo que gana el personal con recibe_comisiones por participar en el servicio. */
export class GuardarComisionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  // Lo más que cabe en la columna Decimal(10,2).
  @Max(99999999.99, { message: 'El monto de la comisión no puede ser mayor a 99,999,999.99' })
  monto: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CambiarRecibeComisionesDto {
  @IsBoolean()
  recibeComisiones: boolean;
}
