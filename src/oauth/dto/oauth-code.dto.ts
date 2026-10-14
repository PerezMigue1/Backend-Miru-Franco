import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Cuerpo de POST /api/oauth/code: lo que llegó a la página /oauth/alexa en su URL. redirect_uri (y client_id
 * si viene) se validan contra la lista de Alexa antes de emitir el código.
 */
export class OauthCodeDto {
  @IsString({ message: 'redirect_uri debe ser texto' })
  @IsNotEmpty({ message: 'redirect_uri es obligatoria' })
  redirect_uri: string;

  @IsOptional()
  @IsString({ message: 'state debe ser texto' })
  state?: string;

  @IsOptional()
  @IsString({ message: 'client_id debe ser texto' })
  client_id?: string;
}
