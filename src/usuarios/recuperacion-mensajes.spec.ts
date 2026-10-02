import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DATOS_NO_COINCIDEN, SIN_PREGUNTA_RECUPERACION, UsuariosService } from './usuarios.service';

/** Servicio con un Prisma que devuelve `usuario` en findUnique. */
function servicioCon(usuario: Record<string, unknown> | null) {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(usuario),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
}

async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('se esperaba un error');
}

describe('Recuperación por pregunta de seguridad: mensajes que no revelan la cuenta', () => {
  it('paso 1: mismo 400 y mismo texto si no existe, es de Google o no tiene pregunta', async () => {
    const casos = [
      null,
      { id: 'u-1', email: 'g@example.com', activo: true, googleId: 'g-1', preguntaSeguridad: null },
      { id: 'u-2', email: 's@example.com', activo: true, googleId: null, preguntaSeguridad: null },
      { id: 'u-3', email: 'i@example.com', activo: false, googleId: null, preguntaSeguridad: '¿Mascota?' },
    ];
    for (const usuario of casos) {
      const e = await errorDe(servicioCon(usuario).obtenerPreguntaSeguridad('alguien@example.com'));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(SIN_PREGUNTA_RECUPERACION);
    }
  });

  it('paso 1: si hay pregunta, la devuelve', async () => {
    const r = await servicioCon({ id: 'u-4', email: 'a@example.com', activo: true, googleId: null, preguntaSeguridad: '¿Mascota?' })
      .obtenerPreguntaSeguridad('a@example.com');
    expect(r).toEqual({ success: true, pregunta: '¿Mascota?' });
  });

  it('paso 2: mismo 400 y mismo texto si el correo no existe, no hay respuesta o la respuesta no coincide', async () => {
    const hash = await bcrypt.hash('Firulais', 4);
    const casos = [
      null,
      { id: 'u-5', email: 'a@example.com', respuestaSeguridad: null },
      { id: 'u-6', email: 'a@example.com', respuestaSeguridad: hash },
    ];
    for (const usuario of casos) {
      const e = await errorDe(servicioCon(usuario).validarRespuestaSeguridad('a@example.com', 'Otra'));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getStatus()).toBe(400);
      expect(e.message).toBe(DATOS_NO_COINCIDEN);
    }
  });
});
