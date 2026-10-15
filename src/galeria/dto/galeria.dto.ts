import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';

/** Id de consentimiento (BigInt en la base): texto de dígitos; también se acepta un número entero. */
const ID_CONSENTIMIENTO = /^[1-9]\d{0,17}$/;
const aTextoDeId = () =>
  Transform(({ obj, key }) => {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isInteger(v) ? String(v) : v;
  });

/** Campos comunes del registro y la edición (todos opcionales en la edición). */
class CamposFotoDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El servicio debe ser un id válido' })
  @Min(1, { message: 'El servicio debe ser un id válido' })
  servicioId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El orden debe ser un número entero' })
  @Min(0, { message: 'El orden no puede ser negativo' })
  @Max(100000, { message: 'El orden es demasiado grande' })
  orden?: number;

  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'visible debe ser verdadero o falso' })
  visible?: boolean;

  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'ilustrativa debe ser verdadero o falso' })
  ilustrativa?: boolean;

  /** true: quien publica declara que no aparece ninguna persona identificable. false: aparece una clienta. */
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'sinPersonasIdentificables debe ser verdadero o falso' })
  sinPersonasIdentificables?: boolean;

  /** Autorización de la clienta que aparece (consentimiento fotos_resultado aceptado y vigente). null la desliga. */
  @IsOptional()
  @aTextoDeId()
  @ValidateIf((_o, v) => v !== null)
  @IsString({ message: 'La autorización debe ser un id válido' })
  @Matches(ID_CONSENTIMIENTO, { message: 'La autorización debe ser un id válido' })
  consentimientoId?: string | null;
}

/**
 * POST /api/galeria: una foto ya subida desde el panel con la firma de POST /api/galeria/firma. Solo el public_id
 * que generó el servidor; la URL la arma el servidor (un campo url se rechaza con 400).
 */
export class CrearFotoDto extends CamposFotoDto {
  @IsString({ message: 'Sube la foto desde el panel de la galería (falta el public_id de la subida).' })
  @MaxLength(200, { message: 'Sube la foto desde el panel de la galería.' })
  publicId: string;

  @IsString({ message: 'El texto alternativo es obligatorio' })
  @MaxLength(400, { message: 'El texto alternativo debe tener como máximo 200 caracteres' })
  alt: string;
}

/** POST /api/galeria/firma: firma de una subida; el servidor decide carpeta y public_id. */
export class FirmaFotoGaleriaDto {
  @IsOptional()
  @BooleanoEstricto()
  @IsBoolean({ message: 'ilustrativa debe ser verdadero o falso' })
  ilustrativa?: boolean;
}

/** PATCH /api/galeria/:id: la imagen no cambia (para otra imagen se sube y registra otra foto). */
export class ActualizarFotoDto extends CamposFotoDto {
  @IsOptional()
  @IsString({ message: 'El texto alternativo debe ser texto' })
  @MaxLength(400, { message: 'El texto alternativo debe tener como máximo 200 caracteres' })
  alt?: string;
}

/** PUT /api/galeria/orden */
export class OrdenGaleriaDto {
  @IsArray({ message: 'ids debe ser una lista' })
  @ArrayMinSize(1, { message: 'Manda al menos una foto' })
  @ArrayMaxSize(1000, { message: 'Demasiadas fotos en una sola orden' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'Cada id debe ser un número entero' })
  @Min(1, { each: true, message: 'Cada id debe ser un número entero' })
  ids: number[];
}

/** GET /api/galeria/panel */
export class FiltrosPanelGaleriaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El servicio debe ser un id válido' })
  @Min(1, { message: 'El servicio debe ser un id válido' })
  servicioId?: number;

  @IsOptional()
  @IsIn(['visible', 'oculta'], { message: 'El estado debe ser visible u oculta' })
  estado?: 'visible' | 'oculta';

  /** "true" o "false" en la query (texto crudo: la conversión implícita volvería "false" en true). */
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsIn(['true', 'false'], { message: 'ilustrativa debe ser true o false' })
  ilustrativa?: 'true' | 'false';
}

/** GET /api/galeria/autorizaciones?q= */
export class BuscarAutorizacionesDto {
  @IsOptional()
  @IsString({ message: 'La búsqueda debe ser texto' })
  @MaxLength(100, { message: 'La búsqueda debe tener como máximo 100 caracteres' })
  q?: string;
}
