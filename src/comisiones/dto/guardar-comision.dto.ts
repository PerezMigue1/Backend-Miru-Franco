import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Monto fijo que gana el personal con recibe_comisiones por participar en el servicio. */
export class GuardarComisionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monto: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CambiarRecibeComisionesDto {
  @IsBoolean()
  recibeComisiones: boolean;
}
