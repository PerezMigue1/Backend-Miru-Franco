import { IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateFacturaDto {
  @IsString()
  @IsOptional()
  uuidFiscal?: string | null;

  @IsString()
  @IsOptional()
  folio?: string | null;

  @IsString()
  @IsOptional()
  serie?: string | null;

  @IsString()
  @IsOptional()
  rfc?: string | null;

  @IsString()
  @IsOptional()
  razonSocial?: string | null;

  @IsString()
  @IsOptional()
  xmlUrl?: string | null;

  @IsString()
  @IsOptional()
  pdfUrl?: string | null;

  @IsString()
  @IsOptional()
  estado?: string | null;

  @IsString()
  @IsOptional()
  clienteNombre?: string | null;

  @IsString()
  @IsOptional()
  concepto?: string | null;

  @IsOptional()
  @Type(() => Number)
  monto?: number | null;
}
