import { IsNotEmpty, IsString } from 'class-validator';

export class CancelarVentaDto {
  @IsString()
  @IsNotEmpty()
  motivoCancelacion: string;
}
