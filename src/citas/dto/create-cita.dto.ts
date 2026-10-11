import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PAGOS_ANTICIPO, type PagoAnticipo } from '../anticipos/anticipos.util';

export class CreateCitaDto {
  @IsUUID()
  @IsNotEmpty()
  clienteId: string;

  @IsUUID()
  @IsNotEmpty()
  especialistaId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId: number;

  @IsDateString()
  fechaHoraInicio: string;

  @IsDateString()
  fechaHoraFin: string;

  @IsOptional()
  @IsString()
  notas?: string;

  /** Desde /operacion: el personal pide el anticipo del servicio (en el portal se pide siempre que el servicio lo tenga). */
  @IsOptional()
  @IsBoolean()
  pedirAnticipo?: boolean;

  /** Cómo se pagará el anticipo (por omisión 'linea'). Se ignora si la cita no pide anticipo. */
  @IsOptional()
  @IsIn(PAGOS_ANTICIPO)
  pagoAnticipo?: PagoAnticipo;
}
