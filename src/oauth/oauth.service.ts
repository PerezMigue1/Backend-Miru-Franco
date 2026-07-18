import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Roles que pueden vincular la Skill de Alexa (empleadas). Un rol 'cliente' no puede vincular. */
const ROLES_PERMITIDOS_ALEXA = ['admin', 'estilista', 'empleado', 'becario'];

@Injectable()
export class OauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private redirectUrisPermitidas(): string[] {
    return (this.configService.get<string>('ALEXA_REDIRECT_URIS') || '')
      .split(',')
      .map((uri) => uri.trim())
      .filter(Boolean);
  }

  /** Valida client_id + redirect_uri antes de redirigir a la página de login (evita open-redirect). */
  validarClienteAutorizacion(clientId: string, redirectUri: string) {
    const clientIdEsperado = this.configService.get<string>('ALEXA_CLIENT_ID');

    if (!clientId || !clientIdEsperado || clientId !== clientIdEsperado) {
      throw new BadRequestException('client_id inválido');
    }
    if (!redirectUri || !this.redirectUrisPermitidas().includes(redirectUri)) {
      throw new BadRequestException('redirect_uri no autorizada');
    }
  }

  /**
   * Genera un código de un solo uso (mismo patrón que AuthService.googleLogin)
   * a partir del JWT de la empleada ya autenticada.
   */
  async generarCodigo(usuarioId: string, rawToken: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rol: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      throw new ForbiddenException('Usuario no encontrado o inactivo');
    }
    if (!ROLES_PERMITIDOS_ALEXA.includes(usuario.rol)) {
      throw new ForbiddenException('Este rol no puede vincular la Skill de Alexa');
    }

    const codigo = crypto.randomBytes(32).toString('hex');
    const expiraEn = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.codigoOAuth.create({
      data: { codigo, token: rawToken, expiraEn, usado: false },
    });

    return codigo;
  }

  validarCredencialesCliente(clientId?: string, clientSecret?: string) {
    const clientIdEsperado = this.configService.get<string>('ALEXA_CLIENT_ID');
    const clientSecretEsperado = this.configService.get<string>('ALEXA_CLIENT_SECRET');

    if (
      !clientId ||
      !clientSecret ||
      !clientIdEsperado ||
      !clientSecretEsperado ||
      clientId !== clientIdEsperado ||
      clientSecret !== clientSecretEsperado
    ) {
      throw new UnauthorizedException('invalid_client');
    }
  }

  /** Intercambia el código de un solo uso por un access_token con forma OAuth2 estándar. */
  async intercambiarCodigoPorAccessToken(codigo: string) {
    const codigoOAuth = await this.prisma.codigoOAuth.findUnique({ where: { codigo } });

    if (!codigoOAuth || codigoOAuth.usado) {
      throw new UnauthorizedException('invalid_grant');
    }

    if (codigoOAuth.expiraEn < new Date()) {
      await this.prisma.codigoOAuth.delete({ where: { codigo } });
      throw new UnauthorizedException('invalid_grant');
    }

    await this.prisma.codigoOAuth.update({
      where: { codigo },
      data: { usado: true },
    });

    return {
      access_token: codigoOAuth.token,
      token_type: 'bearer',
      expires_in: 7 * 24 * 60 * 60, // el JWT de la app expira en 7d (AuthService.generateToken)
    };
  }
}
