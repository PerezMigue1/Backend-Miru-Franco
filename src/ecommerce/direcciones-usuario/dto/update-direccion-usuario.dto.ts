import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TipoDomicilio } from '@prisma/client';

export class UpdateDireccionUsuarioDto {
  @IsString()
  @IsOptional()
  calle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  codigoPostal?: string;

  @IsString()
  @IsOptional()
  estado?: string;

  @IsString()
  @IsOptional()
  municipioAlcaldia?: string;

  @IsString()
  @IsOptional()
  localidad?: string;

  @IsString()
  @IsOptional()
  coloniaBarrio?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  numeroInterior?: string | null;

  @IsString()
  @IsOptional()
  indicaciones?: string | null;

  @IsEnum(TipoDomicilio)
  @IsOptional()
  tipoDomicilio?: TipoDomicilio;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  contactoNombreApellido?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  contactoTelefono?: string;

  @IsBoolean()
  @IsOptional()
  esPrincipal?: boolean;
}
