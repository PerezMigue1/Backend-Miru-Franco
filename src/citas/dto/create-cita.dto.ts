import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
}
