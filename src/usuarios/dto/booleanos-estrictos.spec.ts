import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { crearErrorDeValidacion } from '../../common/filters/errores-validacion';
import { CreateUsuarioDto } from './create-usuario.dto';
import { UpdateUsuarioDto } from './update-usuario.dto';
import { CompletarRegistroGoogleDto } from './completar-registro-google.dto';

/**
 * Booleanos de consentimiento estrictos. La ValidationPipe global (main.ts) usa enableImplicitConversion, que
 * convertía con Boolean(valor): "false" o "no" llegaban como true y pasaban @IsBoolean y @Equals(true), con lo
 * que quedaba evidencia de un consentimiento que la persona negó. Solo el booleano real pasa; cualquier texto da
 * 400 en español. La pipe de esta prueba tiene las mismas opciones que main.ts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  disableErrorMessages: process.env.NODE_ENV === 'production',
  exceptionFactory: crearErrorDeValidacion,
});

async function validar(metatype: new () => object, cuerpo: Record<string, unknown>) {
  try {
    return { valor: await pipe.transform(cuerpo, { type: 'body', metatype } as ArgumentMetadata), errores: null };
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return { valor: null, errores: ((e as BadRequestException).getResponse() as { errors: Record<string, string> }).errors };
  }
}

const REGISTRO = {
  nombre: 'Clienta Prueba',
  email: 'clienta@example.com',
  telefono: '7710000000',
  password: 'Prueba#2026x',
  aceptaTerminos: true,
  aceptaAvisoPrivacidad: true,
};
const GOOGLE = { token: 'token-de-prueba', aceptaTerminos: true, aceptaAvisoPrivacidad: true };

/** Valores que no son booleanos: con la conversión implícita todos (menos "" y 0) se volvían true. */
const TEXTOS = ['false', 'true', 'no', 'sí', '0', '1', 'off', 1, 0];
const EN_INGLES = /must|should|boolean/i;

describe('main.ts: la pipe de esta prueba es la misma que la global', () => {
  it('main.ts sigue con enableImplicitConversion, whitelist, forbidNonWhitelisted y crearErrorDeValidacion', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    for (const opcion of [
      'whitelist: true',
      'forbidNonWhitelisted: true',
      'transform: true',
      'transformOptions: { enableImplicitConversion: true }',
      "disableErrorMessages: process.env.NODE_ENV === 'production'",
      'exceptionFactory: crearErrorDeValidacion',
    ]) {
      expect(main).toContain(opcion);
    }
  });
});

describe.each([
  ['CreateUsuarioDto (POST /usuarios/registro)', CreateUsuarioDto, REGISTRO, ['aceptaTerminos', 'aceptaAvisoPrivacidad', 'recibePromociones', 'consienteDatosSensibles']],
  ['CompletarRegistroGoogleDto (POST /auth/google/completar)', CompletarRegistroGoogleDto, GOOGLE, ['aceptaTerminos', 'aceptaAvisoPrivacidad', 'recibePromociones']],
  ['UpdateUsuarioDto (PATCH /auth/me, PUT /usuarios/:id y /:id/perfil)', UpdateUsuarioDto, {}, ['recibePromociones', 'consienteDatosSensibles']],
] as const)('%s', (_nombre, Dto, base, campos) => {
  it.each(campos.flatMap((campo) => TEXTOS.map((valor) => [campo, valor] as const)))('%s = %j: 400 en español y no llega al servicio', async (campo, valor) => {
    const { valor: transformado, errores } = await validar(Dto, { ...base, [campo]: valor });
    expect(transformado).toBeNull();
    expect(errores?.[campo]).toEqual(expect.any(String));
    expect(errores?.[campo]).not.toMatch(EN_INGLES);
  });

  it.each(campos.filter((c) => !c.startsWith('acepta')))('%s con el booleano real (true y false) pasa tal cual', async (campo) => {
    for (const valor of [true, false]) {
      const { valor: transformado, errores } = await validar(Dto, { ...base, [campo]: valor });
      expect(errores).toBeNull();
      expect((transformado as Record<string, unknown>)[campo]).toBe(valor);
    }
  });
});

describe('Casillas obligatorias del alta: solo true pasa', () => {
  it.each([
    ['CreateUsuarioDto', CreateUsuarioDto, REGISTRO],
    ['CompletarRegistroGoogleDto', CompletarRegistroGoogleDto, GOOGLE],
  ] as const)('%s: aceptaTerminos y aceptaAvisoPrivacidad en false dan 400; en true pasan como booleano', async (_n, Dto, base) => {
    for (const campo of ['aceptaTerminos', 'aceptaAvisoPrivacidad']) {
      const { errores } = await validar(Dto, { ...base, [campo]: false });
      expect(errores?.[campo]).toMatch(/^Debes aceptar/);
    }
    const { valor } = await validar(Dto, base);
    expect(valor).toMatchObject({ aceptaTerminos: true, aceptaAvisoPrivacidad: true });
  });

  it('el cuerpo { aceptaTerminos: "false", aceptaAvisoPrivacidad: "no", recibePromociones: "false" } ya no llega como true, true, true', async () => {
    const { valor, errores } = await validar(CreateUsuarioDto, {
      ...REGISTRO,
      aceptaTerminos: 'false',
      aceptaAvisoPrivacidad: 'no',
      recibePromociones: 'false',
    });
    expect(valor).toBeNull();
    expect(Object.keys(errores ?? {})).toEqual(expect.arrayContaining(['aceptaTerminos', 'aceptaAvisoPrivacidad', 'recibePromociones']));
  });
});
