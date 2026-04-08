import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_FILE_SIZE_BYTES } from './db.constants';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.guard';
import { DbService, type ImportResult } from './db.service';
import {
  IMPORT_ALLOWED_TABLE_REGEX,
  IMPORT_MODES_BY_TABLE,
  TABLAS_PERMITIDAS,
} from './db.constants';
import { ExportDirectService } from './export-direct.service';

@Controller('db')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DbController {
  constructor(
    private readonly dbService: DbService,
    private readonly exportDirectService: ExportDirectService,
  ) {}

  @Get('diagram')
  async diagrama(
    @Query('formato') formato: string,
    @Res() res: Response,
  ): Promise<void> {
    const fmt = (formato?.toLowerCase() || 'mermaid') as 'mermaid' | 'svg' | 'png';
    if (!['mermaid', 'svg', 'png'].includes(fmt)) {
      throw new BadRequestException('formato debe ser mermaid, svg o png');
    }

    const { buffer, filename, contentType } = await this.dbService.generarDiagrama(fmt);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }),
  )
  async importar(
    @UploadedFile() archivo: { buffer: Buffer; originalname?: string; size: number },
    @Body() body: { tabla?: string; formato?: string; modo?: string },
  ): Promise<ImportResult> {
    const tabla = body?.tabla;
    const formato = body?.formato;
    const modo = body?.modo;
    if (!tabla || typeof tabla !== 'string') {
      throw new BadRequestException('El parámetro tabla es requerido');
    }
    if (!IMPORT_ALLOWED_TABLE_REGEX.test(tabla)) {
      throw new BadRequestException('Nombre de tabla inválido');
    }
    if (!TABLAS_PERMITIDAS.includes(tabla as any)) {
      throw new BadRequestException(
        `tabla debe ser una de: ${TABLAS_PERMITIDAS.join(', ')}`,
      );
    }
    if (!archivo || !archivo.buffer) {
      throw new BadRequestException('El archivo es requerido');
    }

    return this.dbService.importar(
      tabla,
      archivo,
      typeof formato === 'string' ? formato : undefined,
      typeof modo === 'string' ? modo : undefined,
    );
  }

  @Get('import/tables')
  tablasImportables() {
    return {
      success: true,
      data: TABLAS_PERMITIDAS.map((tabla) => ({
        tabla,
        modosPermitidos: IMPORT_MODES_BY_TABLE[tabla].modosPermitidos,
        conflictKeys: IMPORT_MODES_BY_TABLE[tabla].conflictKeys,
      })),
    };
  }

  /**
   * Exportación directa / metadatos BD (equivalente a export-direct del front Next).
   * Requiere JWT + rol admin. Mismos query params que la ruta original.
   */
  @Get('export-direct')
  async exportDirect(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exportDirectService.handleGet(query);
    if (result.kind === 'json') {
      res.status(result.status).json(result.body);
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(result.status).send(result.body);
  }

  @Get('export')
  async exportar(
    @Query('tabla') tabla: string,
    @Query('formato') formato: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!tabla || typeof tabla !== 'string') {
      throw new BadRequestException('El parámetro tabla es requerido');
    }
    if (!formato || typeof formato !== 'string') {
      throw new BadRequestException('El parámetro formato es requerido (csv o json)');
    }
    if (!['csv', 'json'].includes(formato.toLowerCase())) {
      throw new BadRequestException('formato debe ser csv o json');
    }
    if (!TABLAS_PERMITIDAS.includes(tabla as any)) {
      throw new BadRequestException(
        `tabla debe ser una de: ${TABLAS_PERMITIDAS.join(', ')}`,
      );
    }

    const { buffer, filename, contentType } = await this.dbService.exportar(
      tabla,
      formato.toLowerCase(),
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
