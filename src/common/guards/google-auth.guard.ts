import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    try {
      // Intentar activar el guard (esto iniciará la autenticación de Passport)
      const result = (await super.canActivate(context)) as boolean;
      
      // Si llegamos aquí en la ruta inicial, Passport ya redirigió
      // Si es el callback, el usuario está autenticado
      return result;
    } catch (error) {
      // Si Passport redirige, puede lanzar un error, pero eso está bien
      // Solo re-lanzamos si es un error real
      throw error;
    }
  }
  
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // Si hay un error y no es una redirección, lanzarlo
    if (err && !err.statusCode) {
      throw err;
    }
    
    // Para el callback, necesitamos el usuario
    if (request.url.includes('callback')) {
      if (!user) {
        throw new Error('Usuario no autenticado');
      }
      return user;
    }
    
    // Para la ruta inicial, devolver cualquier cosa (Passport ya redirigió)
    return user || true;
  }
}

