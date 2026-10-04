import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const limpiar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Persona que llega sin cita: con nombre (y teléfono opcional) si no tiene cuenta, o clienteId si ya es
 * clienta registrada. La cita empieza ahora y dura lo que dura el servicio.
 */
export class CrearCitaSinCitaDto {
  @IsOptional()
  @Transform(limpiar)
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @Transform(limpiar)
  @IsString()
  @MaxLength(20)
  @Matches(/^[0-9+()\s-]*$/, { message: 'El teléfono solo puede tener números, espacios, +, ( ) y guiones' })
  telefono?: string;

  @IsOptional()
  @IsUUID()
  clienteId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioId: number;

  @IsUUID()
  especialistaId: string;

  /** true: la especialista empieza a atenderla en este momento (queda en curso). */
  @IsOptional()
  @IsBoolean()
  iniciarAhora?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}
