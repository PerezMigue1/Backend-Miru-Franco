import { Injectable, ExecutionContext, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { esCodeChallenge, firmarStateApp, leerStateApp } from '../../auth/google-app';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Mismo criterio de siempre: ruta de inicio si la URL no incluye /callback
  private esInicio(request: any): boolean {
    return !!request.url && !request.url.includes('/callback');
  }

  // Login desde la app: sin challenge S256 válido se corta aquí, antes de redirigir a Google
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (this.esInicio(request) && request.query?.origen === 'app' && !esCodeChallenge(request.query.code_challenge)) {
      throw new BadRequestException('code_challenge inválido: debe ser S256 en base64url (43 caracteres).');
    }
    return super.canActivate(context);
  }

  // Sobrescribir getAuthenticateOptions para pasar prompt directamente
  // Esto asegura que el parámetro se incluya en la URL de autorización de Google
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    // Solo aplicar prompt en la ruta de inicio, no en el callback
    if (request.url && !request.url.includes('/callback')) {
      console.log('🔍 GoogleAuthGuard - Aplicando prompt=select_account a la URL de autorización');
      // App: el challenge viaja a Google dentro de un state firmado (canActivate ya lo validó)
      if (request.query?.origen === 'app' && esCodeChallenge(request.query.code_challenge)) {
        return {
          prompt: 'select_account',
          state: firmarStateApp(request.query.code_challenge),
        };
      }
      return {
        prompt: 'select_account',
      };
    }

    return {};
  }

  // Callback de la app: sin usuario no se lanza; el controller redirige al deep link de error
  handleRequest<TUser = any>(err: any, user: any, info: any, context: ExecutionContext, status?: any): TUser {
    const request = context?.switchToHttp().getRequest();
    if (request && !this.esInicio(request) && leerStateApp(request.query?.state)) {
      return (user || null) as TUser;
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
