import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EstadoEnvio } from '@prisma/client';

export class CreateEnvioDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

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
