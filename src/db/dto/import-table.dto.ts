import { IsOptional, IsString, Matches } from 'class-validator';
import { confirmacionImportacion } from '../db.constants';

const CONFIRMACION_REQUERIDA = `Confirmación requerida: escribe exactamente "${confirmacionImportacion('<tabla>')}" en el campo confirmacion`;

/**
 * Campos de texto del multipart de POST /db/import (el archivo llega aparte, por FileInterceptor).
 * confirmacion es obligatoria desde la validación (400 en español sin ella) y el controlador revisa
 * además que sea exactamente "IMPORTAR <tabla>".
 */
export class ImportTableDto {
  @IsOptional()
  @IsString()
  tabla?: string;

  @IsOptional()
  @IsString()
  formato?: string;

  @IsOptional()
  @IsString()
  modo?: string;

  @IsString({ message: CONFIRMACION_REQUERIDA })
  @Matches(/\S/, { message: CONFIRMACION_REQUERIDA })
  confirmacion: string;
}
