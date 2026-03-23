import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateFacturaDto {
  @IsInt()
  @Min(1)
  pedidoId: number;

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
  xmlUrl?: string | null;

  @IsString()
  @IsOptional()
  pdfUrl?: string | null;

  @IsString()
  @IsOptional()
  estado?: string | null;
}
