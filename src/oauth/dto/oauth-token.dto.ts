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
}
