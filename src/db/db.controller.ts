import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
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
  IMPORT_BLOCKED_TABLES,
  IMPORT_ALLOWED_TABLE_REGEX,
  TABLAS_PERMITIDAS,
} from './db.constants';
import { ExportDirectService } from './export-direct.service';
import { TruncateTableDto } from './dto/truncate-table.dto';

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
    const tabla = this.normalizeImportTable(body?.tabla);
    const formato = body?.formato;
    const modo = body?.modo;
    if (!archivo || !archivo.buffer) {
      throw new BadRequestException('El archivo es requerido');
    }

    try {
      return await this.dbService.importar(
        tabla,
        archivo,
        typeof formato === 'string' ? formato : undefined,
        typeof modo === 'string' ? modo : undefined,
      );
    } catch (error: any) {
      this.rethrowImportError(error);
    }
  }

  @Get('import/tables')
  async tablasImportables() {
    const tablas = await this.dbService.getImportTablesMetadata();
    return {
      success: true,
      tablas,
      data: tablas,
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

  @Post('truncate')
  async truncate(@Body() dto: TruncateTableDto) {
    return this.dbService.truncateTable(dto);
  }

  private normalizeImportTable(tabla?: string): string {
    if (!tabla || typeof tabla !== 'string') {
      throw new BadRequestException({
        success: false,
        error: 'El parámetro tabla es requerido',
        message: 'El parámetro tabla es requerido',
      });
    }
    const raw = tabla.trim();
    if (!IMPORT_ALLOWED_TABLE_REGEX.test(raw)) {
      throw new BadRequestException({
        success: false,
        error: 'tabla inválida',
        message: 'tabla inválida',
      });
    }

    const [schemaPart, tablePart] = raw.includes('.') ? raw.split('.', 2) : ['public', raw];
    const schema = (schemaPart || 'public').trim();
    const table = (tablePart || '').trim();
    if (schema !== 'public' || !table || !/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new BadRequestException({
        success: false,
        error: 'Solo se permite importar tablas del schema public',
        message: 'Solo se permite importar tablas del schema public',
      });
    }

    if (IMPORT_BLOCKED_TABLES.includes(table as any)) {
      throw new ForbiddenException({
        success: false,
        error: 'tabla bloqueada por seguridad',
        message: 'tabla bloqueada por seguridad',
      });
    }
    return table;
  }

  private rethrowImportError(error: any): never {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response = error.getResponse() as any;
      if (response && typeof response === 'object' && 'success' in response && 'error' in response) {
        throw error;
      }

      let message = 'error interno';
      if (typeof response === 'string') {
        message = response;
      } else if (Array.isArray(response?.message)) {
        message = response.message.join(', ');
      } else if (typeof response?.message === 'string') {
        message = response.message;
      }
      throw new HttpException(
        { success: false, error: message, message },
        status,
      );
    }
    const fallbackMessage =
      error instanceof Error && typeof error.message === 'string' && error.message.trim()
        ? error.message
        : 'error interno';
    throw new HttpException(
      { success: false, error: fallbackMessage, message: fallbackMessage },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
