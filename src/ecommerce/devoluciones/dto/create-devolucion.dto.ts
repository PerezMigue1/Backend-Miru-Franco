import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CAUSAS_DEVOLUCION, TIPOS_DEVOLUCION, type CausaDevolucion, type TipoDevolucion } from '../politica-devolucion';

/**
 * Solicitud de cambio o reembolso. Sin estado ni monto: nace pendiente y el monto lo calcula el backend
 * (con forbidNonWhitelisted de main.ts, mandarlos responde 400).
 */
export class CreateDevolucionDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

  @IsInt()
  @IsOptional()
  pedidoItemId?: number | null;

  @IsInt()
  @IsOptional()
  pagoId?: number | null;

  @IsString()
  @IsOptional()
  motivo?: string | null;

  /** Tipo y causa obligatorios: con ellos se aplica siempre la política de los términos. */
  @IsIn(TIPOS_DEVOLUCION)
  tipo: TipoDevolucion;

  @IsIn(CAUSAS_DEVOLUCION)
  causa: CausaDevolucion;

  /** Para un cambio por producto sellado: confirmación de que sigue sellado y sin abrir. */
  @IsOptional()
  @IsBoolean()
  sellado?: boolean;
}
