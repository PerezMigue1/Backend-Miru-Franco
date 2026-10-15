import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateUsuarioDto } from './create-usuario.dto';
import { UpdateUsuarioDto } from './update-usuario.dto';
import { alergiasNuevas, traeAlergias } from './consentimiento-datos-sensibles';
import { UsuariosService } from '../usuarios.service';

/**
 * Consentimiento para datos sensibles (alergias). El DTO solo exige que consienteDatosSensibles, si viene, sea un
 * booleano real (booleanos-estrictos.spec.ts). Que sea obligatorio lo decide el servicio, porque solo él sabe si
 * las alergias cambian y si guarda la titular o el personal (consentimientos-edicion.spec.ts).
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });

async function validar(metatype: new () => object, body: Record<string, unknown>) {
  try {
    await pipe.transform(body, { type: 'body', metatype });
    return null;
  } catch (e) {
    return e as BadRequestException;
  }
}

const REGISTRO_BASE = {
  nombre: 'Clienta Prueba',
  email: 'clienta@example.com',
  telefono: '7710000000',
  password: 'Prueba#2026x',
  fechaNacimiento: '1995-05-10T00:00:00.000Z',
  preguntaSeguridad: { pregunta: '¿Mascota?', respuesta: 'Firulais' },
  aceptaTerminos: true,
  aceptaAvisoPrivacidad: true,
};

describe('Consentimiento para datos sensibles (alergias)', () => {
  describe('PUT /usuarios/:id y PATCH /auth/me (UpdateUsuarioDto)', () => {
    it('alergias sin la casilla pasan el DTO: el servicio decide (las mismas alergias no la piden)', async () => {
      expect(await validar(UpdateUsuarioDto, { alergias: 'Amoniaco' })).toBeNull();
      expect(await validar(UpdateUsuarioDto, { perfilCapilar: { alergias: 'Látex' } })).toBeNull();
    });

    it('la casilla en texto ("true") es 400; true o false reales pasan', async () => {
      expect(await validar(UpdateUsuarioDto, { alergias: 'Amoniaco', consienteDatosSensibles: 'true' })).toBeInstanceOf(BadRequestException);
      expect(await validar(UpdateUsuarioDto, { alergias: 'Amoniaco', consienteDatosSensibles: true })).toBeNull();
      expect(await validar(UpdateUsuarioDto, { alergias: 'Amoniaco', consienteDatosSensibles: false })).toBeNull();
    });

    it('sin alergias la casilla es opcional', async () => {
      for (const body of [{ alergias: '' }, { alergias: '   ' }, { alergias: null }, { nombre: 'Sin alergias' }]) {
        expect(await validar(UpdateUsuarioDto, body)).toBeNull();
      }
    });
  });

  describe('POST /usuarios/registro (CreateUsuarioDto)', () => {
    it('perfilCapilar.alergias sin la casilla pasa el DTO (el servicio responde 400 con el mensaje de quien registra)', async () => {
      expect(await validar(CreateUsuarioDto, { ...REGISTRO_BASE, perfilCapilar: { tipoCabello: 'liso', tieneAlergias: true, alergias: 'Amoniaco' } })).toBeNull();
    });

    it('la casilla en texto es 400; con true pasa', async () => {
      const perfilCapilar = { tipoCabello: 'liso', tieneAlergias: true, alergias: 'Amoniaco' };
      expect(await validar(CreateUsuarioDto, { ...REGISTRO_BASE, perfilCapilar, consienteDatosSensibles: 'sí' })).toBeInstanceOf(BadRequestException);
      expect(await validar(CreateUsuarioDto, { ...REGISTRO_BASE, perfilCapilar, consienteDatosSensibles: true })).toBeNull();
    });
  });

  describe('traeAlergias y alergiasNuevas', () => {
    it('traeAlergias: texto directo o dentro de perfilCapilar', () => {
      expect(traeAlergias({ alergias: 'Látex' })).toBe(true);
      expect(traeAlergias({ perfilCapilar: { alergias: 'Látex' } })).toBe(true);
      expect(traeAlergias({ alergias: '  ' })).toBe(false);
      expect(traeAlergias({})).toBe(false);
    });

    it.each([
      ['Látex', null, true],
      ['Látex', 'Polen', true],
      ['Látex', 'Látex', false],
      [' Látex ', 'Látex', false],
      ['', 'Látex', false],
      [null, 'Látex', false],
      ['   ', null, false],
    ])('alergiasNuevas(%j, guardadas %j) = %s', (nuevas, guardadas, esperado) => {
      expect(alergiasNuevas(nuevas, guardadas)).toBe(esperado);
    });
  });

  describe('el consentimiento no se guarda en la base', () => {
    /** Con alergias nuevas y la casilla, el guardado va en la transacción junto con la fila datos_salud. */
    function prismaCon(update: jest.Mock) {
      const prisma: any = {
        usuario: { update, findUnique: jest.fn().mockResolvedValue({ alergias: null, recibePromociones: false }) },
        consentimiento: { create: jest.fn().mockResolvedValue({}) },
        versionDocumentoLegal: { findFirst: jest.fn().mockResolvedValue({ slug: 'aviso-privacidad', version: '2.0', hashTexto: 'a'.repeat(64), vigenteDesde: new Date('2026-10-14') }) },
      };
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
      return prisma;
    }

    it('PUT /usuarios/:id no manda consienteDatosSensibles a Prisma', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u-1' });
      const servicio = new UsuariosService(prismaCon(update), {} as any, {} as any, {} as any);
      await servicio.actualizarUsuario('u-1', { alergias: 'Amoniaco', consienteDatosSensibles: true }, {
        formulario: 'admin-usuario',
        contexto: { ip: null, userAgent: null },
        registradoPorId: 'admin-1',
      });
      expect(update.mock.calls[0][0].data).toEqual({ alergias: 'Amoniaco' });
    });

    it('PATCH /auth/me no manda consienteDatosSensibles a Prisma', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'u-1' });
      const servicio = new UsuariosService(prismaCon(update), {} as any, {} as any, {} as any);
      await servicio.actualizarPerfilUsuario('u-1', { alergias: 'Amoniaco', consienteDatosSensibles: true });
      expect(update.mock.calls[0][0].data).not.toHaveProperty('consienteDatosSensibles');
    });
  });
});
