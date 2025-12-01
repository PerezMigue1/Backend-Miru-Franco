import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // El parámetro prompt: 'select_account' se configura en la estrategia
  // Esto fuerza a Google a mostrar siempre la pantalla de selección de cuenta
}

