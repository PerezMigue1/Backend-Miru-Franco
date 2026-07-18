import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO para actualización parcial de proveedores.
 * Equivalente a Partial<CreateProveedorDto>, definido explícitamente
 * para evitar depender de '@nestjs/mapped-types'.
 */
export class UpdateProveedorDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  contacto?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  productos?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  direccion?: string;
}
