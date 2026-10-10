import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const METODOS_REEMBOLSO = ['efectivo', 'metodo_original'] as const;
export type MetodoReembolso = (typeof METODOS_REEMBOLSO)[number];

/** Rechazar una solicitud: solo la nota para la clienta o el registro interno. */
export class RechazarDevolucionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nota?: string;
}

/** Aprobar: en un reembolso, cómo se devuelve el dinero (por defecto, al método original). */
export class AprobarDevolucionDto extends RechazarDevolucionDto {
  @IsOptional()
  @IsIn(METODOS_REEMBOLSO)
  metodoReembolso?: MetodoReembolso;
}
