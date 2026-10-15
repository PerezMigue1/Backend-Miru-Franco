import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { crearFirma, ROLES_POR_USO, USOS_SUBIDA_PERSONAL, usoDeFirma } from './firma-cloudinary';

export class FirmaSubidaDto {
  @IsIn(USOS_SUBIDA_PERSONAL, { message: 'El uso debe ser galeria o factura' })
  uso: (typeof USOS_SUBIDA_PERSONAL)[number];

  /** Solo en galería: la imagen es ilustrativa (no es foto real de un trabajo del salón). */
  @IsOptional()
  @IsBoolean({ message: 'ilustrativa debe ser verdadero o falso' })
  ilustrativa?: boolean;
}

/**
 * Firmas de Cloudinary para el personal (subida firmada, sin upload presets unsigned).
 * La foto de perfil propia sigue en POST /api/auth/me/foto/firma.
 */
@Controller('subidas')
export class SubidasController {
  /**
   * POST /api/subidas/firma: `galeria` (imágenes de productos y servicios, fotos de otras personas)
   * para el personal; con `ilustrativa: true` la firma es de galeria/ilustrativas. `factura` (PDF del
   * CFDI) solo para admin. Límite holgado porque se suben lotes.
   */
  @Post('firma')
  @UseGuards(JwtAuthGuard, RolesGuard, new RateLimitGuard(30, 60000))
  @Roles(...ROLES_POR_USO.galeria)
  @HttpCode(HttpStatus.OK)
  firma(@CurrentUser() user: any, @Body() dto: FirmaSubidaDto) {
    // Las imágenes (galería, servicios, productos, equipo, promociones y sitio) ya no se firman aquí: van por la
    // subida segura (POST /api/subidas/imagen/firma o /api/galeria/firma), con el public_id que genera el servidor
    // en la carpeta de cada uso. Aquí solo queda el PDF de la factura.
    if (dto.uso !== 'factura') {
      throw new BadRequestException('Las imágenes se suben con el botón "Subir foto" de cada formulario (subida segura con firma del servidor).');
    }
    if (!ROLES_POR_USO[dto.uso].includes(user?.rol)) {
      throw new ForbiddenException({
        message: 'No tienes permisos de administrador para esta acción',
        code: 'INSUFFICIENT_ROLE',
      });
    }
    return { success: true, data: crearFirma(usoDeFirma(dto), user.id) };
  }
}
