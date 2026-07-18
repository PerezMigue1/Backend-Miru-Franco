import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OauthTokenDto {
  @IsIn(['authorization_code'])
  grant_type: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  client_secret?: string;

  /**
   * OAuth2 exige reenviar redirect_uri en el intercambio del token si se usó en /authorize
   * (RFC 6749 §4.1.3). No se usa en la lógica — solo se declara para que el ValidationPipe
   * global (forbidNonWhitelisted) no rechace la petición de Alexa por un campo "desconocido".
   */
  @IsOptional()
  @IsString()
  redirect_uri?: string;
}
