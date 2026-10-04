import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateUsuarioDto } from './create-usuario.dto';
import { UpdateUsuarioDto } from './update-usuario.dto';
import { MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES } from './consentimiento-datos-sensibles';
import { UsuariosService } from '../usuarios.service';

/** Mismas opciones que la ValidationPipe global de main.ts (sin su exceptionFactory). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function validar(metatype: new () => object, body: Record<string, unknown>) {
  try {
    await pipe.transform(body, { type: 'body', metatype });
    return null;
  } catch (e) {
    return e as BadRequestException;
  }
}

function mensajes(e: BadRequestException | null): string[] {
  if (!e) return [];
  const r = e.getResponse() as { message?: string | string[] };
  return Array.isArray(r.message) ? r.message : [String(r.message)];
}

const REGISTRO_BASE = {
  nombre: 'Clienta Prueba',
  email: 'clienta@example.com',
  telefono: '7710000000',
  password: 'Prueba#2026x',
  fechaNacimiento: '1995-05-10T00:00:00.000Z',
  preguntaSeguridad: { pregunta: '¿Mascota?', respuesta: 'Firulais' },
  aceptaAvisoPrivacidad: true,
};

describe('Consentimiento para datos sensibles (alergias)', () => {
  describe('PUT /usuarios/:id y PATCH /auth/me (UpdateUsuarioDto)', () => {
    it('400 con mensaje claro si trae alergias sin consentimiento', async () => {
      const e = await validar(UpdateUsuarioDto, { alergias: 'Amoniaco' });
      expect(e).toBeInstanceOf(BadRequestException);
      expect(mensajes(e)).toContain(MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES);
    });

    it('400 si el consentimiento viene en false', async () => {
      const e = await validar(UpdateUsuarioDto, { alergias: 'Amoniaco', consienteDatosSensibles: false });
      expect(mensajes(e)).toContain(MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES);
    });

    it('400 si las alergias vienen dentro de perfilCapilar sin consentimiento', async () => {
      const e = await validar(UpdateUsuarioDto, { perfilCapilar: { alergias: 'Látex' } });
      expect(mensajes(e)).toContain(MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES);
    });

    it('acepta alergias con consienteDatosSensibles: true', async () => {
      expect(await validar(UpdateUsuarioDto, { alergias: 'Amoniaco', consienteDatosSensibles: true })).toBeNull();
    });

    it('no pide consentimiento si alergias está vacío, en blanco, es null o no viene', async () => {
      for (const body of [{ alergias: '' }, { alergias: '   ' }, { alergias: null }, { nombre: 'Sin alergias' }]) {
        expect(await validar(UpdateUsuarioDto, body)).toBeNull();
      }
    });
  });

  describe('POST /usuarios/registro (CreateUsuarioDto)', () => {
    it('400 con mensaje claro si perfilCapilar.alergias trae texto sin consentimiento', async () => {
      const e = await validar(CreateUsuarioDto, {
        ...REGISTRO_BASE,
        perfilCapilar: { tipoCabello: 'liso', tieneAlergias: true, alergias: 'Amoniaco' },
      });
      expect(e).toBeInstanceOf(BadRequestException);
      expect(mensajes(e)).toContain(MENSAJE_CONSENTIMIENTO_DATOS_SENSIBLES);
    });

    it('acepta el registro con alergias y consentimiento', async () => {
      const e = await validar(CreateUsuarioDto, {
        ...REGISTRO_BASE,
        perfilCapilar: { tipoCabello: 'liso', tieneAlergias: true, alergias: 'Amoniaco' },
        consienteDatosSensibles: true,
      });
      expect(e).toBeNull();
    });

    it('acepta el registro sin alergias y sin consentimiento', async () => {
      const e = await validar(CreateUsuarioDto, {
        ...REGISTRO_BASE,
        perfilCapilar: { tipoCabello: 'liso', tieneAlergias: false },
      });
      expect(e).toBeNull();
    });
  });

  describe('el consentimiento no se guarda en la base', () => {
    it('PUT /usuarios/:id no manda consienteDatosSensibles a Prisma', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u-1' });
      const servicio = new UsuariosService({ usuario: { update } } as any, {} as any, {} as any, {} as any);
      await servicio.actualizarUsuario('u-1', { alergias: 'Amoniaco', consienteDatosSensibles: true });
      expect(update.mock.calls[0][0].data).toEqual({ alergias: 'Amoniaco' });
    });

    it('PATCH /auth/me no manda consienteDatosSensibles a Prisma', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u-1' });
      const servicio = new UsuariosService({ usuario: { update } } as any, {} as any, {} as any, {} as any);
      await servicio.actualizarPerfilUsuario('u-1', { alergias: 'Amoniaco', consienteDatosSensibles: true });
      expect(update.mock.calls[0][0].data).not.toHaveProperty('consienteDatosSensibles');
    });
  });
});
