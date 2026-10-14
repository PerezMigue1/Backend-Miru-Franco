import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateUsuarioDto } from './create-usuario.dto';

/** POST /usuarios/registro: aviso de privacidad aceptado, teléfono de 10 dígitos, tipo de cabello del enum y topes de texto. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/** Los mensajes de objetos anidados llegan con el prefijo del campo (perfilCapilar., preguntaSeguridad.). */
async function mensajes(valor: unknown): Promise<string[]> {
  try {
    await pipe.transform(valor, { type: 'body', metatype: CreateUsuarioDto } as ArgumentMetadata);
    return [];
  } catch (e) {
    const r = (e as BadRequestException).getResponse() as { message?: string | string[] };
    return Array.isArray(r.message) ? r.message : [String(r.message)];
  }
}

const REGISTRO = {
  nombre: 'Clienta Prueba',
  email: 'clienta@example.com',
  telefono: '7710000000',
  password: 'Prueba#2026x',
  fechaNacimiento: '1995-05-10T00:00:00.000Z',
  preguntaSeguridad: { pregunta: '¿Mascota?', respuesta: 'Firulais' },
  perfilCapilar: { tipoCabello: 'rizado' },
  aceptaAvisoPrivacidad: true,
};
const capilar = (extra: Record<string, unknown>) => ({ ...REGISTRO, perfilCapilar: { tipoCabello: 'liso', ...extra } });

describe('CreateUsuarioDto', () => {
  it('el registro completo pasa', async () => {
    expect(await mensajes(REGISTRO)).toEqual([]);
  });

  it('aceptaAvisoPrivacidad=false: 400 "Debes aceptar el aviso de privacidad"', async () => {
    expect(await mensajes({ ...REGISTRO, aceptaAvisoPrivacidad: false })).toEqual(expect.arrayContaining([expect.stringContaining('Debes aceptar el aviso de privacidad')]));
  });

  it.each(['abc', '77100000', '771000000000', '+527710000000', '771 000 0000'])('teléfono "%s": 400 en español', async (telefono) => {
    expect(await mensajes({ ...REGISTRO, telefono })).toEqual(expect.arrayContaining([expect.stringContaining('El teléfono debe tener 10 dígitos')]));
  });

  it.each(['afro', 'xx', ''])('tipoCabello "%s" fuera del enum: 400 (antes 500)', async (tipoCabello) => {
    expect(await mensajes(capilar({ tipoCabello }))).toEqual(expect.arrayContaining([expect.stringContaining('El tipo de cabello debe ser liso, ondulado o rizado')]));
  });

  it.each(['liso', 'ondulado', 'rizado'])('tipoCabello "%s" pasa', async (tipoCabello) => {
    expect(await mensajes(capilar({ tipoCabello }))).toEqual([]);
  });

  it.each([
    ['nombre', { ...REGISTRO, nombre: 'a'.repeat(101) }, 'El nombre no puede pasar de 100 caracteres'],
    ['respuesta', { ...REGISTRO, preguntaSeguridad: { pregunta: '¿Mascota?', respuesta: 'a'.repeat(256) } }, 'La respuesta de seguridad no puede pasar de 255 caracteres'],
    ['colorNatural', capilar({ colorNatural: 'a'.repeat(256) }), 'El color natural no puede pasar de 255 caracteres'],
    ['colorActual', capilar({ colorActual: 'a'.repeat(256) }), 'El color actual no puede pasar de 255 caracteres'],
    ['productosUsados', capilar({ productosUsados: 'a'.repeat(1001) }), 'Los productos usados no pueden pasar de 1000 caracteres'],
    ['alergias', { ...capilar({ alergias: 'a'.repeat(1001) }), consienteDatosSensibles: true }, 'Las alergias no pueden pasar de 1000 caracteres'],
  ])('%s demasiado largo: 400 en español', async (_campo, cuerpo, mensaje) => {
    expect(await mensajes(cuerpo)).toEqual(expect.arrayContaining([expect.stringContaining(mensaje)]));
  });

  it('en el tope exacto pasa', async () => {
    const cuerpo = {
      ...REGISTRO,
      nombre: 'a'.repeat(100),
      preguntaSeguridad: { pregunta: '¿Mascota?', respuesta: 'a'.repeat(255) },
      perfilCapilar: { tipoCabello: 'liso', colorNatural: 'a'.repeat(255), colorActual: 'a'.repeat(255), productosUsados: 'a'.repeat(1000), alergias: 'a'.repeat(1000) },
      consienteDatosSensibles: true,
    };
    expect(await mensajes(cuerpo)).toEqual([]);
  });
});
