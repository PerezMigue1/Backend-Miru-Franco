import { BadRequestException } from '@nestjs/common';
import { PreguntaSeguridadService } from './pregunta-seguridad.service';

/** Los errores de forma de la recuperación por pregunta llegan a la persona: en español y sin nombres de campos en inglés. */
describe('Recuperación por pregunta: mensajes de forma en español', () => {
  it('sin ninguna pregunta y respuesta responde 400 en español (antes "answers vacío")', async () => {
    const servicio = new PreguntaSeguridadService({} as any, {} as any);
    const error = await servicio.verificarRespuesta('alguien@correo.mx', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe('Falta la respuesta a la pregunta de seguridad');
    expect((error as BadRequestException).message).not.toMatch(/answers/i);
  });
});
