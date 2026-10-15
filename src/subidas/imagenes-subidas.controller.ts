import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { BooleanoEstricto } from '../common/utils/booleano-estricto.util';
import { PERMISO_POR_USO, USOS_IMAGEN, type UsoImagen } from './imagenes-subidas';
import { ImagenesSubidasService } from './imagenes-subidas.service';

export class FirmaImagenDto {
  @IsIn(USOS_IMAGEN, { message: 'El uso debe ser galeria, servicios, productos, equipo, promociones, sitio o usuarios' })
  uso: UsoImagen;

  /** Solo galería, servicios y sitio: la imagen es ilustrativa (no es foto real de un trabajo del salón). */
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'ilustrativa debe ser verdadero o falso' })
  ilustrativa?: boolean;
}

/**
 * POST /api/subidas/imagen/firma: firma de UNA imagen con el public_id que genera el servidor dentro de la carpeta del
 * uso (servicios/, productos/, equipo/, promociones/, sitio/ o galeria/). Cada uso pide su permiso: servicios y
 * productos servicios:escritura; equipo, promociones y sitio configuracion:editar; galería galeria:gestionar.
 */
@Controller('subidas/imagen')
export class ImagenesSubidasController {
  constructor(private readonly subidas: ImagenesSubidasService) {}

  @Post('firma')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermisosGuard, new RateLimitGuard(60, 60000))
  @Permisos(...new Set(Object.values(PERMISO_POR_USO)))
  firmar(@Body() dto: FirmaImagenDto, @CurrentUser() usuario: { id: string }, @Request() req: { permisosUsuario?: string[] }) {
    const claves = req.permisosUsuario ?? [];
    if (!claves.includes('*') && !claves.includes(PERMISO_POR_USO[dto.uso])) {
      throw new ForbiddenException('No tienes permiso para subir imágenes de esta sección.');
    }
    return this.subidas.firmar(usuario.id, dto.uso, dto.ilustrativa === true);
  }
}
