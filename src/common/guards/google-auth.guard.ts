import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Sobrescribir getAuthenticateOptions para pasar prompt directamente
  // Esto asegura que el parámetro se incluya en la URL de autorización de Google
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    
    // Solo aplicar prompt en la ruta de inicio, no en el callback
    if (request.url && !request.url.includes('/callback')) {
      console.log('🔍 GoogleAuthGuard - Aplicando prompt=select_account a la URL de autorización');
      return {
        prompt: 'select_account',
      };
    }
    
    return {};
  }
}

