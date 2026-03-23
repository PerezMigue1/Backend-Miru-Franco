import { IsBoolean, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateNotificacionDto {
  @IsUUID()
  usuarioId: string;

  @IsString()
  tipo: string;

  @IsString()
  titulo: string;

  @IsString()
  mensaje: string;

  @IsBoolean()
  @IsOptional()
  leida?: boolean;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
