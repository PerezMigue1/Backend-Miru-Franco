import { BadRequestException, Logger } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

/**
 * Recuperación por SMS con teléfonos repetidos: solo se envía o se acepta un código si el número
 * pertenece a una sola cuenta activa. La respuesta del envío es la misma con 0, 1 o varias cuentas.
 */

const MENSAJE_ENVIO =
  'Si el número está registrado te enviamos un código por SMS. Si no te llega, recupera tu cuenta con tu correo.';
const ANA = { id: 'u-1', email: 'ana@example.com', telefono: '+527711234567' };
const BETO = { id: 'u-2', email: 'beto@example.com', telefono: '7711234567' };

/** Servicio con Prisma y Twilio Verify simulados; `cuentas` es lo que devuelve findMany. */
function servicioCon(cuentas: Array<Record<string, unknown>>, estadoVerificacion = 'approved') {
  const prisma = {
    usuario: {
      findMany: jest.fn().mockResolvedValue(cuentas),
      findFirst: jest.fn().mockResolvedValue(cuentas[0] ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const verifications = { create: jest.fn().mockResolvedValue({ status: 'pending' }) };
  const verificationChecks = { create: jest.fn().mockResolvedValue({ status: estadoVerificacion }) };
  const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
  Object.assign(servicio as any, {
    twilioClient: { verify: { v2: { services: () => ({ verifications, verificationChecks }) } } },
    twilioVerifyServiceSid: 'VA-prueba',
  });
  return { servicio, prisma, verifications, verificationChecks };
}

describe('Recuperación por SMS', () => {
  let logWarn: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('envío del código', () => {
    it('misma respuesta con 0, 1 o 2 cuentas; Twilio solo con una', async () => {
      const casos = [[], [ANA], [ANA, BETO]];
      const respuestas: unknown[] = [];
      const llamadas: number[] = [];
      for (const cuentas of casos) {
        const { servicio, verifications } = servicioCon(cuentas);
        respuestas.push(await servicio.enviarCodigoRecuperacionSMS('771 123 4567'));
        llamadas.push(verifications.create.mock.calls.length);
      }
      expect(respuestas).toEqual([
        { success: true, message: MENSAJE_ENVIO },
        { success: true, message: MENSAJE_ENVIO },
        { success: true, message: MENSAJE_ENVIO },
      ]);
      expect(llamadas).toEqual([0, 1, 0]);
    });

    it('con varias cuentas registra la ambigüedad sin teléfono ni correo', async () => {
      const { servicio } = servicioCon([ANA, BETO]);
      await servicio.enviarCodigoRecuperacionSMS('7711234567');
      expect(logWarn).toHaveBeenCalledTimes(1);
      const texto = String(logWarn.mock.calls[0][0]);
      for (const dato of ['7711234567', 'ana@', 'beto@', 'u-1', 'u-2']) expect(texto).not.toContain(dato);
    });

    it('busca solo cuentas activas, a lo más dos y con un select mínimo', async () => {
      const { servicio, prisma } = servicioCon([ANA]);
      await servicio.enviarCodigoRecuperacionSMS('7711234567');
      const consulta = prisma.usuario.findMany.mock.calls[0][0];
      expect(consulta.where.activo).toBe(true);
      expect(consulta.take).toBe(2);
      expect(Object.keys(consulta.select).sort()).toEqual(['email', 'id', 'telefono']);
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    });

    it('+52, 52 y 10 dígitos buscan la misma cuenta', async () => {
      const candidatosDe = async (telefono: string) => {
        const { servicio, prisma } = servicioCon([ANA]);
        await servicio.enviarCodigoRecuperacionSMS(telefono);
        return prisma.usuario.findMany.mock.calls[0][0].where.OR.map((c: { telefono: string }) => c.telefono);
      };
      for (const telefono of ['+52 771 123 4567', '527711234567', '7711234567']) {
        const candidatos = await candidatosDe(telefono);
        expect(candidatos).toEqual(expect.arrayContaining(['+527711234567', '527711234567', '7711234567']));
      }
    });
  });

  describe('verificación del código', () => {
    it('con una cuenta y código aprobado entrega el token de esa cuenta', async () => {
      const { servicio, prisma } = servicioCon([ANA]);
      const r = await servicio.verificarCodigoRecuperacionSMS('7711234567', '123456');
      expect(r).toEqual({ success: true, token: expect.any(String), email: ANA.email });
      expect(prisma.usuario.update.mock.calls[0][0].where).toEqual({ id: ANA.id });
    });

    it('con dos cuentas: mismo error que un código inválido, sin consultar Twilio ni guardar nada', async () => {
      const { servicio, prisma, verificationChecks } = servicioCon([ANA, BETO]);
      const error = await servicio.verificarCodigoRecuperacionSMS('7711234567', '123456').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Código inválido o expirado');
      expect(verificationChecks.create).not.toHaveBeenCalled();
      expect(prisma.usuario.update).not.toHaveBeenCalled();
      expect(prisma.usuario.findFirst).not.toHaveBeenCalled();
    });

    it('sin cuenta: mismo error y sin update', async () => {
      const { servicio, prisma } = servicioCon([]);
      const error = await servicio.verificarCodigoRecuperacionSMS('7711234567', '123456').catch((e) => e);
      expect(error.message).toBe('Código inválido o expirado');
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });
});
