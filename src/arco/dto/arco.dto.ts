import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Catálogos de solicitudes_arco (mismos CHECK de la migración 20261014130000). */
export const TIPOS_ARCO = ['acceso', 'rectificacion', 'cancelacion', 'oposicion', 'revocacion'] as const;
export type TipoArco = (typeof TIPOS_ARCO)[number];

export const ESTADOS_ARCO = ['recibida', 'en_proceso', 'respondida', 'atendida', 'rechazada'] as const;
export type EstadoArco = (typeof ESTADOS_ARCO)[number];

/** Estados a los que el admin puede mover una solicitud (no se regresa a "recibida"). */
export const ESTADOS_ARCO_ADMIN = ['en_proceso', 'respondida', 'atendida', 'rechazada'] as const;
export type EstadoArcoAdmin = (typeof ESTADOS_ARCO_ADMIN)[number];

/** Consentimientos que se pueden revocar al atender una solicitud de revocación desde la bandeja. */
export const CONSENTIMIENTOS_REVOCABLES = ['promociones', 'datos_salud', 'fotos_resultado'] as const;
export type ConsentimientoRevocable = (typeof CONSENTIMIENTOS_REVOCABLES)[number];

/** POST /arco/solicitudes */
export class CrearSolicitudArcoDto {
  @IsIn(TIPOS_ARCO, { message: `El tipo debe ser uno de: ${TIPOS_ARCO.join(', ')}` })
  tipo: TipoArco;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @MaxLength(2000, { message: 'La descripción no puede pasar de 2000 caracteres' })
  descripcion?: string;
}

/** POST /arco/oposicion */
export class OposicionArcoDto {
  @IsIn(['promociones'], { message: 'Por ahora solo puedes oponerte a recibir promociones (finalidad: promociones)' })
  finalidad: 'promociones';
}

/** PATCH /arco/solicitudes/:id */
export class ActualizarSolicitudArcoDto {
  @IsIn(ESTADOS_ARCO_ADMIN, { message: `El estado debe ser uno de: ${ESTADOS_ARCO_ADMIN.join(', ')}` })
  estado: EstadoArcoAdmin;

  /** Obligatoria al pasar a respondida o rechazada (la valida el servicio). */
  @IsOptional()
  @IsString({ message: 'La respuesta debe ser texto' })
  @MaxLength(5000, { message: 'La respuesta no puede pasar de 5000 caracteres' })
  respuesta?: string;

  /** Obligatoria y no vacía al atender una solicitud de revocación (la valida el servicio); en otros casos no va. */
  @IsOptional()
  @IsArray({ message: 'revocar debe ser una lista' })
  @IsIn(CONSENTIMIENTOS_REVOCABLES, { each: true, message: `Cada consentimiento a revocar debe ser uno de: ${CONSENTIMIENTOS_REVOCABLES.join(', ')}` })
  @ArrayUnique({ message: 'No repitas consentimientos en revocar' })
  revocar?: ConsentimientoRevocable[];
}

/** GET /arco/solicitudes */
export class ListarSolicitudesArcoQueryDto {
  @IsOptional()
  @IsIn(ESTADOS_ARCO, { message: `El estado debe ser uno de: ${ESTADOS_ARCO.join(', ')}` })
  estado?: EstadoArco;

  @IsOptional()
  @IsIn(['true', 'false'], { message: 'vencidas debe ser true o false' })
  vencidas?: string;

  @IsOptional()
  @Matches(/^-?\d{1,6}$/, { message: 'page debe ser un número entero' })
  page?: string;

  @IsOptional()
  @Matches(/^-?\d{1,6}$/, { message: 'limit debe ser un número entero' })
  limit?: string;
}
