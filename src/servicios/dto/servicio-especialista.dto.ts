import { IsNotEmpty, IsUUID } from 'class-validator';

export class AsignarEspecialistaDto {
  @IsUUID()
  @IsNotEmpty()
  usuarioId: string;
}
