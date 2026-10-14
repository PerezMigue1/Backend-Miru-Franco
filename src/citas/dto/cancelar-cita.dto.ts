import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelarCitaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: 'El motivo no puede pasar de 500 caracteres' })
  motivoCancelacion: string;
}
