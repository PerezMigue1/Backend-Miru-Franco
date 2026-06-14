import { IsNotEmpty, IsString } from 'class-validator';

export class CancelarCitaDto {
  @IsString()
  @IsNotEmpty()
  motivoCancelacion: string;
}
