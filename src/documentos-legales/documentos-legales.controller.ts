import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { RevalidarWebInterceptor } from '../common/services/revalidacion-web';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permisos, PermisosGuard } from '../common/guards/permisos.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISO_DOCUMENTOS_LEGALES } from './documentos-legales.constants';
import { DocumentosLegalesService } from './documentos-legales.service';
import { PlantillaDto, PublicarVersionDto, VistaPreviaDto } from './dto/documentos-legales.dto';

const CACHE_PUBLICA = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

/** Texto vigente de los documentos legales, sin sesión (las páginas legales y las casillas de consentimiento). */
@Controller('documentos-legales')
export class DocumentosLegalesPublicoController {
  constructor(private readonly documentos: DocumentosLegalesService) {}

  @Get('vigentes')
  @Header('Cache-Control', CACHE_PUBLICA)
  async vigentes() {
    return { success: true, data: await this.documentos.vigentes() };
  }

  @Get(':slug/vigente')
  @Header('Cache-Control', CACHE_PUBLICA)
  async vigente(@Param('slug') slug: string) {
    return { success: true, data: await this.documentos.vigente(slug) };
  }
}

/**
 * Admin > Documentos legales (permiso configuracion:editar; solo admin). Sin rutas para editar ni borrar versiones:
 * publicar inserta una versión nueva; lo único editable es el borrador.
 */
@Controller('documentos-legales/admin')
@UseGuards(JwtAuthGuard, PermisosGuard)
@Permisos(PERMISO_DOCUMENTOS_LEGALES)
// Al publicar, la web vacía su caché de las páginas legales (la de 60 s queda de respaldo).
@UseInterceptors(RevalidarWebInterceptor)
export class DocumentosLegalesAdminController {
  constructor(private readonly documentos: DocumentosLegalesService) {}

  @Get()
  async listar() {
    return { success: true, data: await this.documentos.listar() };
  }

  /** Documentos vigentes que usan una regla que ya cambió (aviso "requiere publicar una nueva versión"). */
  @Get('afectados-por-reglas')
  async afectados() {
    return { success: true, data: await this.documentos.afectadosPorReglas() };
  }

  /** Lo mismo con reglas propuestas (cuerpo { reglas }), para avisar antes de guardarlas. */
  @Post('afectados-por-reglas')
  @HttpCode(HttpStatus.OK)
  async afectadosPropuestos(@Body() cuerpo: { reglas?: unknown }) {
    return { success: true, data: await this.documentos.afectadosPorReglas(cuerpo?.reglas ?? null) };
  }

  @Get(':slug/versiones')
  async historial(@Param('slug') slug: string) {
    return { success: true, data: await this.documentos.historial(slug) };
  }

  @Get(':slug/versiones/:version')
  async version(@Param('slug') slug: string, @Param('version') version: string) {
    return { success: true, data: await this.documentos.verVersion(slug, version) };
  }

  @Get(':slug/borrador')
  async borrador(@Param('slug') slug: string) {
    return { success: true, data: await this.documentos.borrador(slug) };
  }

  @Put(':slug/borrador')
  async guardarBorrador(@Param('slug') slug: string, @Body() dto: PlantillaDto, @CurrentUser() usuario: { id: string }) {
    return { success: true, data: await this.documentos.guardarBorrador(slug, dto.plantilla, usuario?.id ?? null) };
  }

  @Delete(':slug/borrador')
  async descartarBorrador(@Param('slug') slug: string) {
    return { success: true, data: await this.documentos.descartarBorrador(slug) };
  }

  @Post(':slug/vista-previa')
  @HttpCode(HttpStatus.OK)
  async vistaPrevia(@Param('slug') slug: string, @Body() dto: VistaPreviaDto) {
    return { success: true, data: await this.documentos.vistaPrevia(slug, dto) };
  }

  @Post(':slug/preparar-version')
  @HttpCode(HttpStatus.OK)
  async prepararVersion(@Param('slug') slug: string, @CurrentUser() usuario: { id: string }) {
    return { success: true, data: await this.documentos.prepararVersion(slug, usuario?.id ?? null) };
  }

  @Post(':slug/publicar')
  @HttpCode(HttpStatus.CREATED)
  async publicar(@Param('slug') slug: string, @Body() dto: PublicarVersionDto, @CurrentUser() usuario: { id: string }) {
    return { success: true, data: await this.documentos.publicar(slug, dto, usuario?.id ?? null) };
  }
}
