import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateServicioDto {
  @IsString() @IsNotEmpty()
  nombre: string;

  @IsString() @IsOptional()
  descripcion?: string;

  @IsString() @IsOptional()
  descripcionLarga?: string;

  @IsNumber() @Min(0)
  precio: number;

  @IsInt() @Min(1)
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? parseInt(value, 10) : value)
  duracionMinutos?: number = 30;

  @IsString() @IsOptional()
  categoria?: string;

  @IsBoolean() @IsOptional()
  activo?: boolean = true;

  @IsBoolean() @IsOptional()
  requiereEvaluacion?: boolean = false;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() !== '' ? [value.trim()] : value))
  imagen?: string[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map(i => i.trim()) : value))
  incluye?: string[];

  @IsArray() @IsOptional()
  recomendaciones?: string[] = [];

  @IsArray() @IsOptional()
  productosAsociados?: any[] = [];

  // ESTA LÍNEA ARREGLA EL ERROR TS2339 DE ESPECIALISTAS
  @IsArray() @IsOptional()
  especialistas?: any[] = []; 
}