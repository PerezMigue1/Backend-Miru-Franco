import { IsDateString, IsIn, IsNotEmpty, IsString } from 'class-validator';

const TIPOS_SOLICITUD = ['permiso', 'vacaciones', 'falta_justificada', 'incapacidad'] as const;

/**
 * No lleva `usuarioId`: el solicitante siempre sale del JWT (`req.user.id`), nunca del
 * body — así nadie puede pedir permiso a nombre de otro empleado.
 */
export class CreateSolicitudPermisoDto {
  @IsIn(TIPOS_SOLICITUD)
  tipo: (typeof TIPOS_SOLICITUD)[number];

  @IsDateString()
  fechaInicio: string;

  @IsDateString()
  fechaFin: string;

  @IsString()
  @IsNotEmpty()
  motivo: string;
}
