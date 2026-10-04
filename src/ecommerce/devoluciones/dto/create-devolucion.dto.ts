import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CAUSAS_DEVOLUCION, TIPOS_DEVOLUCION, type CausaDevolucion, type TipoDevolucion } from '../politica-devolucion';

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
  estado: string;

  @IsString()
  @IsOptional()
  motivo?: string | null;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monto?: number | null;

  /** Con tipo y causa se aplica la política de los términos (lo usa el panel de admin). */
  @IsOptional()
  @IsIn(TIPOS_DEVOLUCION)
  tipo?: TipoDevolucion;

  @IsOptional()
  @IsIn(CAUSAS_DEVOLUCION)
  causa?: CausaDevolucion;

  /** Para un cambio por producto sellado: confirmación de que sigue sellado y sin abrir. */
  @IsOptional()
  @IsBoolean()
  sellado?: boolean;
}
