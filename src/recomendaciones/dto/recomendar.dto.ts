import { IsArray, ArrayNotEmpty, IsString, IsOptional, IsInt, Min, IsIn } from 'class-validator';

export class RecomendarDto {
  /**
   * Nombres de servicios/productos que el cliente ya tiene en su carrito
   * o cita (ej. ["Corte de Cabello Dama", "Botox Capilar"]).
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  items: string[];

  /** Máximo de recomendaciones a devolver. Por defecto 5. */
  @IsOptional()
  @IsInt()
  @Min(1)
  topN?: number;

  /**
   * Filtra por tipo de regla:
   * - alta_confianza: producto -> servicio (sugerencia casi segura)
   * - confianza_amplia: servicio -> producto (sugerencia exploratoria)
   * Si se omite, se devuelven ambos tipos.
   */
  @IsOptional()
  @IsIn(['alta_confianza', 'confianza_amplia'])
  tipo?: string;
}
