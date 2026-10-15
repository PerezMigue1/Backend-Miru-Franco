import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateUsuarioDto } from './update-usuario.dto';
import { UsuariosService } from '../usuarios.service';

/**
 * PATCH /auth/me, PUT /usuarios/:id/perfil y PUT /usuarios/:id: perfilCapilar validado como objeto anidado
 * (antes `any`: {colorNatural:123} borraba el dato y {tipoCabello:'xx'} daba 500) y teléfono de 10 dígitos.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function mensajes(valor: unknown): Promise<string[]> {
  try {
    await pipe.transform(valor, { type: 'body', metatype: UpdateUsuarioDto } as ArgumentMetadata);
    return [];
  } catch (e) {
    const r = (e as BadRequestException).getResponse() as { message?: string | string[] };
    return Array.isArray(r.message) ? r.message : [String(r.message)];
  }
}
const contiene = (texto: string) => expect.arrayContaining([expect.stringContaining(texto)]);

describe('UpdateUsuarioDto.perfilCapilar', () => {
  it.each([
    ['colorNatural numérico', { colorNatural: 123 }],
    ['tipoCabello fuera del enum', { tipoCabello: 'xx' }],
    ['alergias de más de 1000 caracteres', { alergias: 'a'.repeat(1001) }],
    ['colorActual de más de 255 caracteres', { colorActual: 'a'.repeat(256) }],
  ])('%s: 400', async (_caso, perfilCapilar) => {
    expect(await mensajes({ perfilCapilar, consienteDatosSensibles: true })).not.toEqual([]);
  });

  it('tipoCabello fuera del enum: mensaje en español', async () => {
    expect(await mensajes({ perfilCapilar: { tipoCabello: 'xx' } })).toEqual(contiene('El tipo de cabello debe ser liso, ondulado o rizado'));
  });

  it('un perfil capilar válido pasa (también con tratamientos)', async () => {
    const perfilCapilar = { tipoCabello: 'ondulado', colorNatural: 'Castaño', colorActual: 'Rubio', productosUsados: 'Shampoo', alergias: 'Látex', tratamientosQuimicos: true, tratamientos: 'Tinte' };
    expect(await mensajes({ perfilCapilar, consienteDatosSensibles: true })).toEqual([]);
  });
});

describe('UpdateUsuarioDto.telefono', () => {
  it.each(['abc', '12345', '+527710000000'])('"%s": 400 en español', async (telefono) => {
    expect(await mensajes({ telefono })).toEqual(contiene('El teléfono debe tener 10 dígitos'));
  });

  it.each(['7710000000', '', null])('%p se acepta (vacío o null lo borran, como hoy)', async (telefono) => {
    expect(await mensajes({ telefono })).toEqual([]);
  });
});

describe('PUT /usuarios/:id (admin) con perfilCapilar', () => {
  it('no manda perfilCapilar a Prisma (antes 500): lo pasa a las columnas, sanitizado', async () => {
    // Las alergias ya guardadas no piden otra vez el consentimiento (consentimientos-edicion.spec.ts)
    const prisma: any = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({ alergias: 'Látex', recibePromociones: false }),
        update: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
    const admin = { formulario: 'admin-usuario' as const, contexto: { ip: null, userAgent: null }, registradoPorId: 'admin-1' };
    await servicio.actualizarUsuario('u-1', { nombre: 'Ana', perfilCapilar: { tipoCabello: 'rizado', colorNatural: ' Negro\u0000 ', alergias: 'Látex' } }, admin);
    const data = prisma.usuario.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('perfilCapilar');
    expect(data).toMatchObject({ nombre: 'Ana', tipoCabello: 'rizado', colorNatural: 'Negro', alergias: 'Látex' });
  });
});
