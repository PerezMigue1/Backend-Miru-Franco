import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OauthService } from './oauth.service';
import { OauthTokenDto } from './dto/oauth-token.dto';

/**
 * Account Linking de la Skill de Alexa (Auth Code Grant estándar OAuth2).
 * No confundir con /api/auth/exchange-code (flujo interno de la app, forma de respuesta distinta).
 */
@Controller('oauth')
export class OauthController {
  constructor(
    private readonly oauthService: OauthService,
    private readonly configService: ConfigService,
  ) {}

  /** GET /api/oauth/authorize — punto de entrada que Alexa abre al pulsar "Vincular cuenta". */
  @Get('authorize')
  authorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    this.oauthService.validarClienteAutorizacion(clientId, redirectUri);

    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
    const url = `${frontendUrl}/oauth/alexa?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state ?? '')}`;
    res.redirect(url);
  }

  /** POST /api/oauth/code — la página de login del frontend cambia el JWT de la empleada por un código de un solo uso. */
  @Post('code')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generarCodigo(@Req() req: any) {
    const codigo = await this.oauthService.generarCodigo(req.user.id, req.rawToken);
    return { success: true, code: codigo };
  }

  /** POST /api/oauth/token — Alexa intercambia el código por un access_token (forma OAuth2 estándar). */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async token(@Body() dto: OauthTokenDto, @Headers('authorization') authHeader?: string) {
    const { clientId, clientSecret } = this.extraerCredenciales(dto, authHeader);
    this.oauthService.validarCredencialesCliente(clientId, clientSecret);

    if (!dto.code) {
      throw new UnauthorizedException('invalid_request');
    }

    return this.oauthService.intercambiarCodigoPorAccessToken(dto.code);
  }

  /** Alexa puede enviar client_id/client_secret vía HTTP Basic o en el body, según el esquema configurado en la consola. */
  private extraerCredenciales(dto: OauthTokenDto, authHeader?: string) {
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const separador = decoded.indexOf(':');
      if (separador === -1) return { clientId: undefined, clientSecret: undefined };
      return {
        clientId: decoded.slice(0, separador),
        clientSecret: decoded.slice(separador + 1),
      };
    }
    return { clientId: dto.client_id, clientSecret: dto.client_secret };
  }
}
