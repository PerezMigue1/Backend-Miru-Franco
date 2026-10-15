import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsObject,
  IsIn,
  ValidateIf,
  ValidateNested,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ROLES_DB } from '../../common/constants/roles.constants';
import { ConsentimientoDatosSensibles } from './consentimiento-datos-sensibles';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';
import { MAX_TRATAMIENTOS } from '../tratamientos';

/** Roles permitidos en BD: cliente, becario, empleado, estilista, admin. Solo admin puede asignar. */
export const ROLES_PERMITIDOS = [...ROLES_DB] as const;
export type RolPermitido = (typeof ROLES_PERMITIDOS)[number];

/** perfilCapilar anidado (antes `any`): mismos topes que los campos sueltos. */
class PerfilCapilarUpdateDto {
  @IsOptional()
  @IsIn(['liso', 'ondulado', 'rizado'], { message: 'El tipo de cabello debe ser liso, ondulado o rizado' })
  tipoCabello?: 'liso' | 'ondulado' | 'rizado';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  colorNatural?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  colorActual?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  productosUsados?: string;

  @IsOptional()
  @IsBoolean()
  tieneAlergias?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  alergias?: string;

  @IsOptional()
  @IsBoolean()
  tratamientosQuimicos?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(MAX_TRATAMIENTOS)
  tratamientos?: string | null;
}

export class UpdateUsuarioDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  /** 10 dígitos; vacío o null lo borran (como antes). */
  @ValidateIf((_, v) => v !== null && v !== undefined && v !== '')
  @IsString()
  @Matches(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' })
  telefono?: string | null;

  @IsDateString()
  @IsOptional()
  fechaNacimiento?: string;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilCapilarUpdateDto)
  perfilCapilar?: PerfilCapilarUpdateDto;

  // Campos de perfil capilar embebidos (edición directa desde clientes-crm).
  // El service (actualizarUsuario) los persiste tal cual en las columnas del Usuario.
  @IsOptional()
  @IsIn(['liso', 'ondulado', 'rizado'])
  tipoCabello?: 'liso' | 'ondulado' | 'rizado';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  colorNatural?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  colorActual?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  productosUsados?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  alergias?: string;

  /** Si es false, tratamientos queda en null (ver usuarios/tratamientos.ts). */
  @IsOptional()
  @IsBoolean()
  tratamientosQuimicos?: boolean;

  /** Texto libre; null o vacío lo borra. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(MAX_TRATAMIENTOS)
  tratamientos?: string | null;

  /**
   * Obligatorio (true) si el guardado pone alergias con texto distintas de las guardadas: lo exige el servicio
   * (400 con errors.consienteDatosSensibles). No se guarda.
   */
  @ConsentimientoDatosSensibles()
  consienteDatosSensibles?: boolean;

  /**
   * Booleano real. Si cambia, queda su fila de consentimiento (aceptado o revocado). El personal solo puede
   * ponerlo en false; de false a true lo decide solo la persona (400).
   */
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'El campo recibePromociones debe ser verdadero o falso' })
  recibePromociones?: boolean;

  /**
   * Pantalla del panel que guarda (ruta_origen de los consentimientos que registra el personal). No se guarda en la
   * cuenta. Sin ella: "/admin/usuarios-roles". En el perfil de la titular siempre es "/perfil".
   */
  @IsOptional()
  @IsString({ message: 'La ruta de origen debe ser texto' })
  @MaxLength(300, { message: 'La ruta de origen no puede pasar de 300 caracteres' })
  rutaOrigen?: string;

  /**
   * URL de la foto de perfil. Envía `null` o cadena vacía para quitarla.
   * Alineado con `Usuario.foto` (Prisma `String?`).
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(4096)
  foto?: string | null;

  /** Rol del usuario. Solo admin puede cambiar (PUT :id o PATCH :id/rol). */
  @IsString()
  @IsOptional()
  @IsIn(ROLES_PERMITIDOS)
  rol?: RolPermitido;
}

