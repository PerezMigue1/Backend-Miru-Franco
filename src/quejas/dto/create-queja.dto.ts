import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateQuejaDto {
  @IsString()
  @IsNotEmpty()
  asunto: string;

  @IsString()
  @IsNotEmpty()
  descripcion: string;

  /** Solo admin puede especificar a qué cliente asignar la queja.
   *  Si el solicitante es cliente, se usa su propio usuarioId. */
  @IsOptional()
  @IsUUID()
  usuarioId?: string;
}
