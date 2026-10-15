import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import {
  ACCIONES_CONSENTIMIENTO,
  AccionConsentimiento,
  SLUGS_DOCUMENTO,
  SlugDocumento,
  TIPOS_CONSENTIMIENTO,
  TipoConsentimiento,
} from '../consentimientos.constants';

/** Formato de versión del registro de la web ("X.Y") y del hash (SHA-256 en hexadecimal). */
export const REGEX_VERSION_DOCUMENTO = /^\d{1,3}\.\d{1,3}$/;
export const REGEX_HASH_DOCUMENTO = /^[0-9a-f]{64}$/;

export class ItemConsentimientoDto {
  @IsIn(TIPOS_CONSENTIMIENTO, { message: `El tipo debe ser uno de: ${TIPOS_CONSENTIMIENTO.join(', ')}` })
  tipo: TipoConsentimiento;

  @IsOptional()
  @IsIn(SLUGS_DOCUMENTO, { message: `El documento debe ser uno de: ${SLUGS_DOCUMENTO.join(', ')}` })
  documentoSlug?: SlugDocumento;

  @IsOptional()
  @IsString({ message: 'La versión debe ser texto' })
  @Matches(REGEX_VERSION_DOCUMENTO, { message: 'La versión debe tener la forma X.Y' })
  version?: string;

  @IsOptional()
  @IsString({ message: 'El hash debe ser texto' })
  @Matches(REGEX_HASH_DOCUMENTO, { message: 'El hash debe ser SHA-256 en hexadecimal (64 caracteres)' })
  hash?: string;

  @IsIn(ACCIONES_CONSENTIMIENTO, { message: 'La acción debe ser aceptado o revocado' })
  accion: AccionConsentimiento;
}

/** POST /consentimientos. ip, user agent, fecha y método los pone el backend o la base: no se aceptan aquí. */
export class RegistrarConsentimientosDto {
  @IsArray({ message: 'items debe ser una lista' })
  @ArrayMinSize(1, { message: 'Envía al menos un consentimiento' })
  @ArrayMaxSize(10, { message: 'Envía como máximo 10 consentimientos a la vez' })
  @ValidateNested({ each: true })
  @Type(() => ItemConsentimientoDto)
  items: ItemConsentimientoDto[];

  /** Formulario o pantalla donde se marcó la casilla (registro, banner_cookies, checkout…). */
  @IsString({ message: 'El formulario debe ser texto' })
  @IsNotEmpty({ message: 'Indica el formulario' })
  @MaxLength(80, { message: 'El formulario no puede pasar de 80 caracteres' })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'El formulario solo admite letras, números, guion y guion bajo' })
  formulario: string;

  @IsOptional()
  @IsString({ message: 'La ruta de origen debe ser texto' })
  @MaxLength(300, { message: 'La ruta de origen no puede pasar de 300 caracteres' })
  rutaOrigen?: string;

  /** Identificador del navegador sin sesión (obligatorio si no hay sesión). */
  @IsOptional()
  @IsString({ message: 'visitanteId debe ser texto' })
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'visitanteId debe tener de 8 a 64 caracteres: letras, números, guion o guion bajo' })
  visitanteId?: string;
}

/** GET /consentimientos/admin */
export class ListarConsentimientosAdminQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'La búsqueda no puede pasar de 100 caracteres' })
  q?: string;

  @IsOptional()
  @Matches(/^-?\d{1,6}$/, { message: 'page debe ser un número entero' })
  page?: string;

  @IsOptional()
  @Matches(/^-?\d{1,6}$/, { message: 'limit debe ser un número entero' })
  limit?: string;
}

/** GET /consentimientos/admin/export */
export class ExportarConsentimientosQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'usuarioId no puede pasar de 64 caracteres' })
  usuarioId?: string;

  @IsOptional()
  @IsIn(['csv'], { message: 'El único formato disponible es csv' })
  formato?: 'csv';
}
