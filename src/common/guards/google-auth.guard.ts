import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // No sobrescribir canActivate - dejar que Passport maneje todo
  // El método handleRequest se ejecuta después de que Passport procesa
}

