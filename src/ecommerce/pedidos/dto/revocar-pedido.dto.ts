import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Revocación de compra (art. 56 LFPC): la clienta no tiene que dar razones; el motivo es opcional. */
export class RevocarPedidoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'El motivo no puede pasar de 500 caracteres' })
  motivo?: string;
}
