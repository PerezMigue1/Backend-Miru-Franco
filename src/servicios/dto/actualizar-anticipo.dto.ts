import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/** PUT /servicios/:id/anticipo. 0 o null quitan el anticipo del servicio. */
export class ActualizarAnticipoServicioDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999)
  anticipoMonto?: number | null;
}
