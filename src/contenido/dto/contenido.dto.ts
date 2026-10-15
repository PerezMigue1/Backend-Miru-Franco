import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { BooleanoEstricto } from '../../common/utils/booleano-estricto.util';

/** Texto crudo del cuerpo (null incluido): la conversión implícita no lo toca. */
const Crudo = () => Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);

const Orden = (campo: string) => [
  IsOptional(),
  Type(() => Number),
  IsInt({ message: `${campo} debe ser un número entero` }),
  Min(0, { message: `${campo} no puede ser negativo` }),
  Max(100000, { message: `${campo} es demasiado grande` }),
];

function aplicar(...decoradores: PropertyDecorator[]): PropertyDecorator {
  return (objetivo, propiedad) => decoradores.forEach((d) => d(objetivo, propiedad));
}

/** Texto opcional que acepta null para borrarlo. */
const TextoOpcional = (max: number, mensaje: string) =>
  aplicar(IsOptional(), Crudo(), ValidateIf((_o, v) => v !== null), IsString({ message: mensaje }), MaxLength(max, { message: mensaje }));

const Booleano = (campo: string) => aplicar(IsOptional(), BooleanoEstricto(), IsBoolean({ message: `${campo} debe ser verdadero o falso` }));

// ---------------------------------------------------------------- Promociones

class CamposPromocionDto {
  @TextoOpcional(500, 'La imagen debe subirse con el botón "Subir foto"')
  imagenUrl?: string | null;

  @TextoOpcional(300, 'El enlace debe ser una ruta interna del sitio que empiece con "/"')
  enlace?: string | null;

  /** Día 'YYYY-MM-DD' en hora de México (desde las 00:00). */
  @TextoOpcional(10, 'La fecha de inicio debe tener el formato AAAA-MM-DD')
  vigenteDesde?: string | null;

  /** Día 'YYYY-MM-DD' en hora de México (todo ese día incluido). */
  @TextoOpcional(10, 'La fecha de fin debe tener el formato AAAA-MM-DD')
  vigenteHasta?: string | null;

  @Booleano('activa')
  activa?: boolean;

  @Booleano('destacada')
  destacada?: boolean;

  @aplicar(...Orden('El orden'))
  orden?: number;
}

export class CrearPromocionDto extends CamposPromocionDto {
  @IsString({ message: 'El título es obligatorio' })
  @MaxLength(400, { message: 'El título debe tener como máximo 120 caracteres' })
  titulo: string;

  @IsString({ message: 'La descripción es obligatoria' })
  @MaxLength(4000, { message: 'La descripción debe tener como máximo 1000 caracteres' })
  descripcion: string;
}

export class ActualizarPromocionDto extends CamposPromocionDto {
  @IsOptional()
  @IsString({ message: 'El título debe ser texto' })
  @MaxLength(400, { message: 'El título debe tener como máximo 120 caracteres' })
  titulo?: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser texto' })
  @MaxLength(4000, { message: 'La descripción debe tener como máximo 1000 caracteres' })
  descripcion?: string;
}

// ---------------------------------------------------------------- Preguntas frecuentes

export class CrearPreguntaDto {
  @IsString({ message: 'La pregunta es obligatoria' })
  @MaxLength(800, { message: 'La pregunta debe tener como máximo 200 caracteres' })
  pregunta: string;

  @IsString({ message: 'La respuesta es obligatoria' })
  @MaxLength(8000, { message: 'La respuesta debe tener como máximo 2000 caracteres' })
  respuesta: string;

  @aplicar(...Orden('El orden'))
  orden?: number;

  @Booleano('visible')
  visible?: boolean;
}

export class ActualizarPreguntaDto {
  @IsOptional()
  @IsString({ message: 'La pregunta debe ser texto' })
  @MaxLength(800, { message: 'La pregunta debe tener como máximo 200 caracteres' })
  pregunta?: string;

  @IsOptional()
  @IsString({ message: 'La respuesta debe ser texto' })
  @MaxLength(8000, { message: 'La respuesta debe tener como máximo 2000 caracteres' })
  respuesta?: string;

  @aplicar(...Orden('El orden'))
  orden?: number;

  @Booleano('visible')
  visible?: boolean;
}

// ---------------------------------------------------------------- Equipo

export class ActualizarPerfilPublicoDto {
  @Booleano('mostrarEnSitio')
  mostrarEnSitio?: boolean;

  @TextoOpcional(500, 'La foto debe subirse con el botón "Subir foto"')
  fotoPublica?: string | null;

  @TextoOpcional(2400, 'La presentación debe tener como máximo 600 caracteres')
  bioPublica?: string | null;

  @aplicar(...Orden('El orden'))
  ordenPublico?: number;
}

// ---------------------------------------------------------------- Orden

export class OrdenContenidoDto {
  @IsArray({ message: 'ids debe ser una lista' })
  @ArrayMinSize(1, { message: 'Manda al menos un elemento' })
  @ArrayMaxSize(500, { message: 'Demasiados elementos en una sola orden' })
  @Type(() => Number)
  @IsInt({ each: true, message: 'Cada id debe ser un número entero' })
  @Min(1, { each: true, message: 'Cada id debe ser un número entero' })
  ids: number[];
}
