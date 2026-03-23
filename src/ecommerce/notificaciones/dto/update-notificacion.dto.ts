import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateNotificacionDto {
  @IsString()
  @IsOptional()
  tipo?: string;

  @IsString()
  @IsOptional()
  titulo?: string;

  @IsString()
  @IsOptional()
  mensaje?: string;

  @IsBoolean()
  @IsOptional()
  leida?: boolean;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
