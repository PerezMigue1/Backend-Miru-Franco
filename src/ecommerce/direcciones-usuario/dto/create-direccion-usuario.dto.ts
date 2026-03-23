import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TipoDomicilio } from '@prisma/client';

export class CreateDireccionUsuarioDto {
  @IsString()
  @IsNotEmpty()
  calle: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  codigoPostal: string;

  @IsString()
  @IsNotEmpty()
  estado: string;

  @IsString()
  @IsNotEmpty()
  municipioAlcaldia: string;

  @IsString()
  @IsNotEmpty()
  localidad: string;

  @IsString()
  @IsNotEmpty()
  coloniaBarrio: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  numeroInterior?: string;

  @IsString()
  @IsOptional()
  indicaciones?: string;

  @IsEnum(TipoDomicilio)
  tipoDomicilio: TipoDomicilio;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  contactoNombreApellido: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  contactoTelefono: string;

  @IsBoolean()
  @IsOptional()
  esPrincipal?: boolean;
}
