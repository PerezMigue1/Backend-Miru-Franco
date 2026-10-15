import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBoolean,
  IsDate,
  IsDateString,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNotEmptyObject,
  IsNumber,
  IsNumberString,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CompletarRegistroGoogleDto } from '../../usuarios/dto/completar-registro-google.dto';
import { VerificarRespuestaDto } from '../../pregunta-seguridad/dto/verificar-respuesta.dto';
import { crearErrorDeValidacion } from './errores-validacion';

/**
 * El ValidationPipe global (main.ts) responde en español: las constraints sin mensaje propio salen
 * con el texto por defecto de class-validator en inglés y se traducen; los mensajes propios no cambian.
 */
enum Color { rojo = 'rojo', azul = 'azul' }

class Linea {
  @IsInt()
  cantidad!: number;
}

class Formulario {
  @IsOptional() @IsNotEmpty() nombre?: string;
  @IsOptional() @IsString() apodo?: unknown; // unknown: sin conversión implícita a texto
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsInt() edad?: number;
  @IsOptional() @IsNumber() precio?: number;
  @IsOptional() @Min(1) minimo?: number;
  @IsOptional() @Max(10) maximo?: number;
  @IsOptional() @MinLength(3) clave?: string;
  @IsOptional() @MaxLength(5) codigo?: string;
  @IsOptional() @IsIn(['a', 'b']) letra?: string;
  @IsOptional() @IsEnum(Color) color?: Color;
  @IsOptional() @IsBoolean() activo?: unknown;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsUUID() uuid?: string;
  @IsOptional() @IsPositive() monto?: number;
  @IsOptional() @Matches(/^\d{5}$/) cp?: string;
  @IsOptional() @IsArray() lista?: string[];
  @IsOptional() @ArrayNotEmpty() items?: string[];
  @IsOptional() @IsString({ message: 'El teléfono debe ser texto' }) telefono?: unknown;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => Linea) lineas?: Linea[];
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: crearErrorDeValidacion,
});

async function errores(cuerpo: Record<string, unknown>): Promise<Record<string, string>> {
  try {
    await pipe.transform(cuerpo, { type: 'body', metatype: Formulario });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const r = (e as BadRequestException).getResponse() as Record<string, any>;
    expect(r).toMatchObject({ success: false, error: 'Errores de validación', message: 'Revisa los campos del formulario' });
    return r.errors;
  }
  throw new Error('Se esperaba un 400');
}

describe('Errores de validación en español', () => {
  it.each([
    ['isNotEmpty', { nombre: '' }, 'nombre', 'El campo nombre es obligatorio'],
    ['isString', { apodo: 5 }, 'apodo', 'El campo apodo debe ser texto'],
    ['isEmail', { email: 'x' }, 'email', 'El campo email debe ser un correo válido'],
    ['isInt', { edad: 1.5 }, 'edad', 'El campo edad debe ser un número entero'],
    ['isNumber', { precio: 'abc' }, 'precio', 'El campo precio debe ser un número'],
    ['min', { minimo: 0 }, 'minimo', 'El campo minimo debe ser al menos 1'],
    ['max', { maximo: 11 }, 'maximo', 'El campo maximo no debe ser mayor que 10'],
    ['minLength', { clave: 'ab' }, 'clave', 'El campo clave debe tener al menos 3 caracteres'],
    ['maxLength', { codigo: 'abcdef' }, 'codigo', 'El campo codigo debe tener como máximo 5 caracteres'],
    ['isIn', { letra: 'z' }, 'letra', 'El campo letra debe ser uno de: a, b'],
    ['isEnum', { color: 'verde' }, 'color', 'El campo color debe ser uno de: rojo, azul'],
    ['isBoolean', { activo: 'zz' }, 'activo', 'El campo activo debe ser verdadero o falso'],
    ['isDateString', { fecha: 'xx' }, 'fecha', 'El campo fecha debe ser una fecha válida'],
    ['isUUID', { uuid: 'no' }, 'uuid', 'El campo uuid debe ser un identificador válido'],
    ['isPositive', { monto: -1 }, 'monto', 'El campo monto debe ser mayor que 0'],
    ['matches', { cp: 'abc' }, 'cp', 'El campo cp no tiene el formato correcto'],
    ['isArray', { lista: 'x' }, 'lista', 'El campo lista debe ser una lista'],
    ['arrayNotEmpty', { items: [] }, 'items', 'El campo items no puede estar vacío'],
    ['whitelistValidation', { sobra: 1 }, 'sobra', 'El campo sobra no está permitido'],
  ])('%s sin mensaje propio sale en español', async (_constraint, cuerpo, campo, mensaje) => {
    const r = await errores(cuerpo);
    expect(r[campo]).toBe(mensaje);
  });

  it('en objetos anidados usa el nombre del campo y conserva la ruta', async () => {
    const r = await errores({ lineas: [{ cantidad: 'x' }] });
    expect(r['lineas.0.cantidad']).toBe('El campo cantidad debe ser un número entero');
  });

  it('un mensaje propio en español no cambia', async () => {
    const r = await errores({ telefono: 5 });
    expect(r.telefono).toBe('El teléfono debe ser texto');
  });

  it('ningún mensaje queda en inglés', async () => {
    const r = await errores({ nombre: '', apodo: 1, edad: 'x', sobra: true, letra: 'q' });
    for (const m of Object.values(r)) expect(m).not.toMatch(/\b(should|must|property)\b/);
  });
});

describe('Respaldo para más restricciones sin mensaje propio', () => {
  class Extra {
    @IsOptional() @IsObject() datos?: unknown;
    @IsDefined() requerido?: unknown;
    @IsOptional() @ArrayMinSize(2) pocos?: string[];
    @IsOptional() @ArrayMaxSize(1) muchos?: string[];
    @IsOptional() @IsNumberString() folio?: unknown;
    @IsOptional() @IsUrl() sitio?: string;
    @IsOptional() @Equals(true) acepta?: unknown;
    @IsOptional() @IsDate() dia?: unknown;
    @IsOptional() @IsNotEmptyObject() lleno?: unknown;
  }

  it.each([
    ['isObject', { requerido: 1, datos: 'x' }, 'datos', 'El campo datos debe ser un objeto'],
    ['isDefined', {}, 'requerido', 'El campo requerido es obligatorio'],
    ['arrayMinSize', { requerido: 1, pocos: ['a'] }, 'pocos', 'El campo pocos debe tener al menos 2 elementos'],
    ['arrayMaxSize', { requerido: 1, muchos: ['a', 'b'] }, 'muchos', 'El campo muchos debe tener como máximo 1 elementos'],
    ['isNumberString', { requerido: 1, folio: 'abc' }, 'folio', 'El campo folio debe contener solo números'],
    ['isUrl', { requerido: 1, sitio: 'no es url' }, 'sitio', 'El campo sitio debe ser una URL válida'],
    ['equals', { requerido: 1, acepta: false }, 'acepta', 'El campo acepta no tiene el valor esperado'],
    ['isDate', { requerido: 1, dia: 'x' }, 'dia', 'El campo dia debe ser una fecha válida'],
    ['isNotEmptyObject', { requerido: 1, lleno: {} }, 'lleno', 'El campo lleno no puede estar vacío'],
  ])('%s sin mensaje propio sale en español', async (_c, cuerpo, campo, mensaje) => {
    const r = await erroresDe(Extra, cuerpo, pipe);
    expect(r[campo]).toBe(mensaje);
  });
});

describe('Con la configuración de producción de main.ts (disableErrorMessages) y DTO reales', () => {
  const pipeProduccion = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    disableErrorMessages: true,
    exceptionFactory: crearErrorDeValidacion,
  });

  it('forbidNonWhitelisted ("property X should not exist") sale en español también en producción', async () => {
    const r = await erroresDe(Formulario, { sobra: 1, otro: 'x' }, pipeProduccion);
    expect(r).toEqual({ sobra: 'El campo sobra no está permitido', otro: 'El campo otro no está permitido' });
  });

  it('VerificarRespuestaDto (recuperación por pregunta) sin mensajes propios: todo en español', async () => {
    const r = await erroresDe(VerificarRespuestaDto, { email: 'no-es-correo', answers: 'texto', extra: 1 }, pipeProduccion);
    expect(r).toEqual({
      email: 'El campo email debe ser un correo válido',
      answers: 'El campo answers debe ser un objeto',
      extra: 'El campo extra no está permitido',
    });
    for (const m of Object.values(r)) expect(m).not.toMatch(/\b(should|must|property|value)\b/);
  });

  it('CompletarRegistroGoogleDto: recibePromociones no booleano sale en español', async () => {
    const r = await erroresDe(CompletarRegistroGoogleDto, { token: 't', aceptaTerminos: true, aceptaAvisoPrivacidad: true, recibePromociones: 'quiza' }, pipeProduccion);
    expect(r.recibePromociones).toMatch(/^El campo recibePromociones debe ser verdadero o falso/);
    for (const m of Object.values(r)) expect(m).not.toMatch(/\b(should|must|property|boolean)\b/);
  });
});

async function erroresDe(metatype: new () => object, cuerpo: Record<string, unknown>, conPipe: ValidationPipe): Promise<Record<string, string>> {
  try {
    await conPipe.transform(cuerpo, { type: 'body', metatype });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as Record<string, any>).errors;
  }
  throw new Error('Se esperaba un 400');
}
