import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFacturaDto {
  @IsIn(['nota', 'cfdi'])
  tipo: 'nota' | 'cfdi';

  @IsOptional()
  @IsInt()
  @Min(1)
  pedidoId?: number;

  // --- Nota simple (no fiscal): requeridos solo si tipo='nota' ---
  @ValidateIf((o) => o.tipo === 'nota')
  @IsString()
  @IsNotEmpty()
  clienteNombre?: string;

  @ValidateIf((o) => o.tipo === 'nota')
  @IsString()
  @IsNotEmpty()
  concepto?: string;

  @ValidateIf((o) => o.tipo === 'nota')
  @Type(() => Number)
  @Min(0.01)
  monto?: number;

  // --- CFDI (fiscal): opcionales a nivel de DTO; el service exige folio o uuidFiscal ---
  @IsOptional()
  @IsString()
  uuidFiscal?: string | null;

  @IsOptional()
  @IsString()
  folio?: string | null;

  @IsOptional()
  @IsString()
  serie?: string | null;

  @IsOptional()
  @IsString()
  rfc?: string | null;

  @IsOptional()
  @IsString()
  razonSocial?: string | null;

  @IsOptional()
  @IsString()
  xmlUrl?: string | null;

  @IsOptional()
  @IsString()
  pdfUrl?: string | null;

  @IsOptional()
  @IsString()
  estado?: string | null;
}
