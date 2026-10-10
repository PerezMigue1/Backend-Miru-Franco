import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { crearFirma, ROLES_POR_USO, USOS_SUBIDA_PERSONAL } from './firma-cloudinary';

export class FirmaSubidaDto {
  @IsIn(USOS_SUBIDA_PERSONAL)
  uso: (typeof USOS_SUBIDA_PERSONAL)[number];
}

/**
 * Firmas de Cloudinary para el personal (subida firmada, sin upload presets unsigned).
 * La foto de perfil propia sigue en POST /api/auth/me/foto/firma.
 */
@Controller('subidas')
export class SubidasController {
  /**
   * POST /api/subidas/firma: `galeria` (imágenes de productos y servicios, fotos de otras personas)
   * para el personal; `factura` (PDF del CFDI) solo para admin. Límite holgado porque se suben lotes.
   */
  @Post('firma')
  @UseGuards(JwtAuthGuard, RolesGuard, new RateLimitGuard(30, 60000))
  @Roles(...ROLES_POR_USO.galeria)
  @HttpCode(HttpStatus.OK)
  firma(@CurrentUser() user: any, @Body() dto: FirmaSubidaDto) {
    if (!ROLES_POR_USO[dto.uso].includes(user?.rol)) {
      throw new ForbiddenException({
        message: 'No tienes permisos de administrador para esta acción',
        code: 'INSUFFICIENT_ROLE',
      });
    }
    return { success: true, data: crearFirma(dto.uso, user.id) };
  }
}
