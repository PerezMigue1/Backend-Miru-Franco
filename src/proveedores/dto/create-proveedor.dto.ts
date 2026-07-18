import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProveedorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

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
