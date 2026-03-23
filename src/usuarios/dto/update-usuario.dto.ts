import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsObject,
  IsIn,
  ValidateIf,
  MaxLength,
} from 'class-validator';
import { ROLES_DB } from '../../common/constants/roles.constants';

/** Roles permitidos en BD: cliente, becario, empleado, estilista, admin. Solo admin puede asignar. */
export const ROLES_PERMITIDOS = [...ROLES_DB] as const;
export type RolPermitido = (typeof ROLES_PERMITIDOS)[number];

export class UpdateUsuarioDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsDateString()
  @IsOptional()
  fechaNacimiento?: string;

  @IsObject()
  @IsOptional()
  perfilCapilar?: any;

  @IsBoolean()
  @IsOptional()
  recibePromociones?: boolean;

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

