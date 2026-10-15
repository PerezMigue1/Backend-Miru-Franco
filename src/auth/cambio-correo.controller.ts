import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CambioCorreoService } from './cambio-correo.service';
import { SolicitarCambioCorreoDto } from './dto/solicitar-cambio-correo.dto';
import { ConfirmarCambioCorreoDto } from './dto/confirmar-cambio-correo.dto';

/** Cambio de correo desde el perfil, en dos pasos: código al correo nuevo y confirmación. */
@Controller('auth')
export class CambioCorreoController {
  constructor(private readonly cambioCorreo: CambioCorreoService) {}

  /**
   * Paso 1: con la contraseña actual (si la cuenta tiene), envía un código de 6 dígitos al correo nuevo
   * (vence en 15 minutos). Sin contraseña (solo Google), envía además otro código al correo actual.
   */
  @Post('me/correo/solicitar')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(3, 60000))
  @HttpCode(HttpStatus.OK)
  solicitar(@CurrentUser() user: { id: string }, @Body() dto: SolicitarCambioCorreoDto) {
    return this.cambioCorreo.solicitar(user.id, dto.correoNuevo, dto.passwordActual);
  }

  /**
   * Paso 2: con el código correcto cambia el correo de la cuenta (máximo 5 intentos), avisa al correo anterior y
   * anula la recuperación de contraseña y los códigos pendientes.
   */
  @Post('me/correo/confirmar')
  @UseGuards(JwtAuthGuard, new RateLimitGuard(5, 60000))
  @HttpCode(HttpStatus.OK)
  confirmar(@CurrentUser() user: { id: string }, @Body() dto: ConfirmarCambioCorreoDto) {
    return this.cambioCorreo.confirmar(user.id, dto.codigo, dto.codigoActual);
  }
}
