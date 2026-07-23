import { IsDateString, IsOptional } from 'class-validator';

/** La jefa/admin corrige un registro existente — nunca crea uno nuevo desde aquí. */
export class CorregirAsistenciaDto {
  @IsOptional()
  @IsDateString()
  horaEntrada?: string;

  @IsOptional()
  @IsDateString()
  horaSalida?: string;
}
