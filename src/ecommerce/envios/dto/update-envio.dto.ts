import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoEnvio } from '@prisma/client';

export class UpdateEnvioDto {
  @IsString()
  @IsOptional()
  empresaEnvio?: string | null;

  @IsString()
  @IsOptional()
  numeroGuia?: string | null;

  @IsEnum(EstadoEnvio)
  @IsOptional()
  estadoEnvio?: EstadoEnvio;

  @IsDateString()
  @IsOptional()
  fechaEnvio?: string | null;

  @IsDateString()
  @IsOptional()
  fechaEntrega?: string | null;

  @IsString()
  @IsOptional()
  notas?: string | null;
}
