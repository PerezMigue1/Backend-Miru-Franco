import { BadGatewayException, BadRequestException, CanActivate, ConflictException, ExecutionContext, INestApplication, Logger, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { EmailModule } from '../email/email.module';
import { CambioCorreoService } from './cambio-correo.service';

/**
 * Cambio de correo desde el perfil: POST /auth/me/correo/solicitar y /auth/me/correo/confirmar.
 * La base va en memoria y el EmailService simulado: no sale ningún correo real.
 */

// randomInt simulable (por defecto el real) para revisar que el código sale de crypto.randomInt.
jest.mock('crypto', () => {
  const real = jest.requireActual('crypto');
  return { ...real, randomInt: jest.fn((...a: unknown[]) => real.randomInt(...a)) };
});
const randomInt = crypto.randomInt as unknown as jest.Mock;

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CambioCorreoController } = require('./cambio-correo.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthModule } = require('./auth.module');

/** Evalúa el `where` de Prisma que usa el servicio sobre una fila en memoria. */
function coincide(fila: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
    if (k === 'NOT') return !coincide(fila, cond);
    const v = fila[k];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date || typeof cond !== 'object') return v === cond || (v instanceof Date && v.getTime() === cond?.getTime?.());
    if ('equals' in cond) {
      return cond.mode === 'insensitive' ? String(v).toLowerCase() === String(cond.equals).toLowerCase() : v === cond.equals;
    }
    if ('gt' in cond && !(v > cond.gt)) return false;
    if ('lte' in cond && !(v <= cond.lte)) return false;
    return true;
  });
}

/** Contraseña ficticia de la clienta de prueba (solo existe en esta prueba). */
const PASSWORD = 'ClaveFicticia-123';
const HASH_PASSWORD = bcrypt.hashSync(PASSWORD, 4);

function baseEnMemoria() {
  const usuarios: any[] = [
    {
      id: 'u-1',
      email: 'clienta@example.com',
      password: HASH_PASSWORD,
      // Recuperación de contraseña y código OTP pendientes del correo anterior
      resetPasswordToken: 'token-recuperacion-falso',
      resetPasswordExpires: new Date(Date.now() + 10 * 60_000),
      codigoOTP: 'codigo-otp-falso',
      otpExpira: new Date(Date.now() + 10 * 60_000),
    },
    { id: 'u-2', email: 'ocupado@example.com', password: HASH_PASSWORD },
    // Cuenta que solo entra con Google: no tiene contraseña
    { id: 'u-3', email: 'solo.google@example.com', password: null, googleId: 'g-3' },
  ];
  const solicitudes: any[] = [];
  const aplicar = (fila: any, data: any) => {
    for (const [k, v] of Object.entries(data)) fila[k] = v && typeof v === 'object' && 'increment' in (v as any) ? fila[k] + (v as any).increment : v;
  };
  const prisma: any = {
    usuarios,
    solicitudes,
    usuario: {
      findUnique: jest.fn(async ({ where }: any) => {
        const u = usuarios.find((x) => x.id === where.id);
        return u ? { ...u } : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => usuarios.find((u) => coincide(u, where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const u = usuarios.find((x) => x.id === where.id)!;
        if (data.email && usuarios.some((o) => o.id !== u.id && o.email === data.email)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'prueba' });
        }
        Object.assign(u, data);
        return { ...u };
      }),
    },
    solicitudCambioCorreo: {
      create: jest.fn(async ({ data }: any) => {
        const fila = { id: solicitudes.length + 1, intentos: 0, usadoEn: null, creadoEn: new Date(), ...data };
        solicitudes.push(fila);
        return { ...fila };
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const filas = solicitudes.filter((s) => coincide(s, where));
        return filas.length ? { ...filas[filas.length - 1] } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const filas = solicitudes.filter((s) => coincide(s, where));
        filas.forEach((s) => aplicar(s, data));
        return { count: filas.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = solicitudes.find((x) => x.id === where.id)!;
        aplicar(s, data);
        return { ...s };
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

function preparar(opciones: { correoFalla?: boolean; avisoFalla?: boolean; correoActualFalla?: boolean } = {}) {
  const prisma = baseEnMemoria();
  const enviados: { correo: string; codigo: string; minutos: number }[] = [];
  // Códigos que van al correo ACTUAL (cuentas sin contraseña)
  const alActual: { correo: string; codigo: string; correoNuevo: string; minutos: number }[] = [];
  const email = {
    sendCodigoCambioCorreoEmail: jest.fn(async (correo: string, codigo: string, minutos: number) => {
      enviados.push({ correo, codigo, minutos });
      if (opciones.correoFalla) throw new Error('No se pudo enviar el correo (código de cambio de correo)');
    }),
    sendCodigoCorreoActualEmail: jest.fn(async (correo: string, codigo: string, correoNuevo: string, minutos: number) => {
      alActual.push({ correo, codigo, correoNuevo, minutos });
      if (opciones.correoActualFalla) throw new Error('No se pudo enviar el correo (código al correo actual)');
    }),
    sendAvisoCorreoCambiadoEmail: jest.fn(async () => {
      if (opciones.avisoFalla) throw new Error('No se pudo enviar el correo (aviso de cambio de correo)');
    }),
  };
  const servicio = new CambioCorreoService(prisma, email as any);
  return { prisma, email, enviados, alActual, servicio };
}

describe('CambioCorreoService', () => {
  const salidas: string[] = [];
  beforeEach(() => {
    salidas.length = 0;
    const capturar = (...a: unknown[]) => salidas.push(a.map(String).join(' '));
    for (const m of ['log', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(capturar);
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capturar as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('solicitar: código de 6 dígitos con crypto.randomInt, al correo nuevo; solo se guarda el hash bcrypt y vence en 15 minutos', async () => {
    randomInt.mockClear().mockImplementationOnce(() => 4821);
    const { prisma, enviados, servicio } = preparar();
    const antes = Date.now();
    const res = await servicio.solicitar('u-1', '  Nuevo.Correo@Example.com ', PASSWORD);
    expect(randomInt).toHaveBeenCalled();
    expect(enviados).toEqual([{ correo: 'nuevo.correo@example.com', codigo: '004821', minutos: 15 }]);
    const [guardada] = prisma.solicitudes;
    expect(guardada.correoNuevo).toBe('nuevo.correo@example.com');
    expect(guardada.codigoHash).not.toContain('004821');
    expect(await bcrypt.compare('004821', guardada.codigoHash)).toBe(true);
    expect(guardada.expiraEn.getTime() - antes).toBeGreaterThanOrEqual(15 * 60_000 - 50);
    expect(guardada.expiraEn.getTime() - antes).toBeLessThanOrEqual(15 * 60_000 + 5_000);
    expect(JSON.stringify(res)).not.toContain('004821');
    expect(salidas.join('\n')).not.toContain('004821');
  });

  it('código correcto: cambia usuarios.email, marca usado_en y responde el correo nuevo', async () => {
    const { prisma, enviados, servicio } = preparar();
    await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
    const res = await servicio.confirmar('u-1', enviados[0].codigo);
    expect(res).toMatchObject({ success: true, data: { email: 'nuevo@example.com' } });
    expect(prisma.usuarios[0].email).toBe('nuevo@example.com');
    expect(prisma.solicitudes[0].usadoEn).toBeInstanceOf(Date);
    expect(JSON.stringify(res)).not.toContain(enviados[0].codigo);
    expect(salidas.join('\n')).not.toContain(enviados[0].codigo);
    // Ya usado: no sirve otra vez.
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('código incorrecto: suma un intento, dice cuántos quedan y el correo no cambia', async () => {
    const { prisma, enviados, servicio } = preparar();
    await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
    const otro = enviados[0].codigo === '000000' ? '111111' : '000000';
    await expect(servicio.confirmar('u-1', otro)).rejects.toThrow('El código no es correcto. Te quedan 4 intentos.');
    expect(prisma.solicitudes[0].intentos).toBe(1);
    expect(prisma.usuarios[0].email).toBe('clienta@example.com');
  });

  it('6 intentos: tras 5 códigos incorrectos, ni el correcto sirve', async () => {
    const { prisma, enviados, servicio } = preparar();
    await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
    const otro = enviados[0].codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(servicio.confirmar('u-1', otro)).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toThrow('Llegaste al máximo de intentos. Pide un código nuevo.');
    expect(prisma.usuarios[0].email).toBe('clienta@example.com');
  });

  it('código vencido: falla aunque sea el correcto', async () => {
    const { prisma, enviados, servicio } = preparar();
    await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
    prisma.solicitudes[0].expiraEn = new Date(Date.now() - 1000);
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toThrow('El código venció. Pide uno nuevo.');
    expect(prisma.usuarios[0].email).toBe('clienta@example.com');
  });

  it('una solicitud nueva invalida la anterior: el código viejo ya no sirve', async () => {
    const { prisma, enviados, servicio } = preparar();
    randomInt.mockImplementationOnce(() => 111111).mockImplementationOnce(() => 222222);
    await servicio.solicitar('u-1', 'primero@example.com', PASSWORD);
    await servicio.solicitar('u-1', 'segundo@example.com', PASSWORD);
    expect(prisma.solicitudes[0].expiraEn.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.confirmar('u-1', enviados[1].codigo)).resolves.toMatchObject({ data: { email: 'segundo@example.com' } });
  });

  it('correo tomado por otra cuenta (sin importar mayúsculas): 409 en español, sin correo ni solicitud', async () => {
    const { prisma, email, servicio } = preparar();
    const error = await servicio.solicitar('u-1', 'OCUPADO@example.com', PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('Ese correo ya está registrado en otra cuenta.');
    expect(email.sendCodigoCambioCorreoEmail).not.toHaveBeenCalled();
    expect(prisma.solicitudes).toHaveLength(0);
  });

  it('correo tomado mientras se confirmaba: 409 y el correo no cambia', async () => {
    const { prisma, enviados, servicio } = preparar();
    await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
    prisma.usuarios[1].email = 'nuevo@example.com';
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.usuarios[0].email).toBe('clienta@example.com');
  });

  it('el correo nuevo igual al actual: 400 en español', async () => {
    const { servicio } = preparar();
    await expect(servicio.solicitar('u-1', 'CLIENTA@example.com', PASSWORD)).rejects.toThrow('El correo nuevo es igual al actual. Escribe uno distinto.');
  });

  it('si el envío falla: error claro en español y la solicitud no queda usable', async () => {
    const { enviados, servicio, prisma } = preparar({ correoFalla: true });
    const error = await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD).catch((e) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe('No pudimos enviar el código a tu nuevo correo. Revisa que esté bien escrito o intenta de nuevo en unos minutos.');
    await expect(servicio.confirmar('u-1', enviados[0].codigo)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.usuarios[0].email).toBe('clienta@example.com');
    expect(salidas.join('\n')).not.toContain(enviados[0].codigo);
    expect(salidas.join('\n')).not.toContain('nuevo@example.com');
  });

  it('sin solicitud pendiente: 400 en español', async () => {
    const { servicio } = preparar();
    await expect(servicio.confirmar('u-1', '123456')).rejects.toThrow('No tienes un cambio de correo pendiente. Pide un código nuevo.');
  });

  describe('contraseña actual al solicitar (cuentas con contraseña)', () => {
    it.each([
      ['sin contraseña', undefined],
      ['vacía', ''],
    ])('%s: 400 "Escribe tu contraseña actual para cambiar tu correo.", sin código ni solicitud', async (_caso, password) => {
      const { prisma, email, servicio } = preparar();
      const error = await servicio.solicitar('u-1', 'nuevo@example.com', password).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).message).toBe('Escribe tu contraseña actual para cambiar tu correo.');
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'PASSWORD_ACTUAL_REQUERIDA' });
      expect(email.sendCodigoCambioCorreoEmail).not.toHaveBeenCalled();
      expect(prisma.solicitudes).toHaveLength(0);
    });

    it('incorrecta: 400 (no 401, que cierra la sesión en la web) "La contraseña actual no es correcta.", sin código ni solicitud', async () => {
      const { prisma, email, servicio } = preparar();
      const error = await servicio.solicitar('u-1', 'nuevo@example.com', 'OtraClaveFicticia-9').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).not.toBeInstanceOf(UnauthorizedException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).message).toBe('La contraseña actual no es correcta.');
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'PASSWORD_ACTUAL_INCORRECTA' });
      expect(email.sendCodigoCambioCorreoEmail).not.toHaveBeenCalled();
      expect(prisma.solicitudes).toHaveLength(0);
    });

    it('se revisa antes que el correo: con contraseña incorrecta no revela si el correo nuevo ya está registrado', async () => {
      const { servicio } = preparar();
      const error = await servicio.solicitar('u-1', 'ocupado@example.com', 'OtraClaveFicticia-9').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('La contraseña actual no es correcta.');
    });

    it('la contraseña no sale en la respuesta ni en los logs', async () => {
      const { servicio } = preparar();
      const res = await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
      expect(JSON.stringify(res)).not.toContain(PASSWORD);
      expect(salidas.join('\n')).not.toContain(PASSWORD);
    });

    it('con contraseña no se manda nada al correo actual y la respuesta no pide ese código', async () => {
      const { alActual, servicio } = preparar();
      await expect(servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD)).resolves.toMatchObject({ codigoAlCorreoActual: false });
      expect(alActual).toEqual([]);
    });
  });

  describe('cuentas solo de Google (sin contraseña): el código del correo actual sustituye a la contraseña', () => {
    it('no se pide contraseña; un código va al correo nuevo y otro, distinto, al correo ACTUAL, y la respuesta lo dice', async () => {
      const { prisma, enviados, alActual, servicio } = preparar();
      const r = await servicio.solicitar('u-3', 'nuevo.google@example.com');
      expect(r).toMatchObject({ success: true, codigoAlCorreoActual: true });
      expect(r.message).toContain('correo actual');
      expect(enviados.map((e) => e.correo)).toEqual(['nuevo.google@example.com']);
      expect(alActual).toHaveLength(1);
      expect(alActual[0]).toMatchObject({ correo: 'solo.google@example.com', correoNuevo: 'nuevo.google@example.com', minutos: 15 });
      expect(alActual[0].codigo).toMatch(/^[0-9]{6}$/);
      // Solo se guarda un hash: ninguno de los dos códigos queda en claro
      const guardada = JSON.stringify(prisma.solicitudes[0]);
      expect(guardada).not.toContain(enviados[0].codigo);
      expect(guardada).not.toContain(alActual[0].codigo);
    });

    it('con solo el código del correo nuevo NO cambia el correo (una sesión robada no basta) y gasta un intento', async () => {
      const { prisma, enviados, servicio } = preparar();
      await servicio.solicitar('u-3', 'nuevo.google@example.com');
      await expect(servicio.confirmar('u-3', enviados[0].codigo)).rejects.toMatchObject({ response: { code: 'CODIGO_INCORRECTO' } });
      expect(prisma.usuarios[2].email).toBe('solo.google@example.com');
      expect(prisma.solicitudes[0].intentos).toBe(1);
    });

    it('con el código del correo actual equivocado tampoco cambia', async () => {
      const { prisma, enviados, alActual, servicio } = preparar();
      await servicio.solicitar('u-3', 'nuevo.google@example.com');
      const otro = alActual[0].codigo === '000000' ? '111111' : '000000';
      await expect(servicio.confirmar('u-3', enviados[0].codigo, otro)).rejects.toMatchObject({ response: { code: 'CODIGO_INCORRECTO' } });
      expect(prisma.usuarios[2].email).toBe('solo.google@example.com');
    });

    it('con los dos códigos correctos cambia el correo y avisa al anterior', async () => {
      const { prisma, email, enviados, alActual, servicio } = preparar();
      await servicio.solicitar('u-3', 'nuevo.google@example.com');
      await expect(servicio.confirmar('u-3', enviados[0].codigo, alActual[0].codigo)).resolves.toMatchObject({
        data: { email: 'nuevo.google@example.com' },
      });
      expect(prisma.usuarios[2].email).toBe('nuevo.google@example.com');
      expect((email.sendAvisoCorreoCambiadoEmail.mock.calls[0] as unknown as [string])[0]).toBe('solo.google@example.com');
    });

    it('si falla el envío al correo actual: 502 en español y la solicitud no queda usable', async () => {
      const { prisma, enviados, servicio } = preparar({ correoActualFalla: true });
      await expect(servicio.solicitar('u-3', 'nuevo.google@example.com')).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.solicitudes[0].intentos).toBe(5);
      await expect(servicio.confirmar('u-3', enviados[0].codigo)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.usuarios[2].email).toBe('solo.google@example.com');
    });
  });

  describe('al confirmar', () => {
    it('avisa al correo ANTERIOR (no al nuevo) con la fecha y hora; el código siguió yendo al nuevo', async () => {
      const { email, enviados, servicio } = preparar();
      await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
      expect(enviados.map((e) => e.correo)).toEqual(['nuevo@example.com']);
      await servicio.confirmar('u-1', enviados[0].codigo);
      expect(email.sendAvisoCorreoCambiadoEmail).toHaveBeenCalledTimes(1);
      const [destino, fechaHora] = email.sendAvisoCorreoCambiadoEmail.mock.calls[0] as unknown as [string, string];
      expect(destino).toBe('clienta@example.com');
      expect(typeof fechaHora).toBe('string');
      expect(fechaHora).toMatch(/\d/);
      expect(salidas.join('\n')).not.toContain('clienta@example.com');
    });

    it('limpia en la misma escritura del correo los tokens de recuperación y los códigos OTP pendientes', async () => {
      const { prisma, enviados, servicio } = preparar();
      await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
      await servicio.confirmar('u-1', enviados[0].codigo);
      expect(prisma.usuarios[0]).toMatchObject({
        email: 'nuevo@example.com',
        resetPasswordToken: null,
        resetPasswordExpires: null,
        codigoOTP: null,
        otpExpira: null,
      });
      // Una sola escritura de la cuenta: correo y limpieza juntos, dentro de la transacción
      const escrituras = prisma.usuario.update.mock.calls.map((c: any[]) => c[0]);
      expect(escrituras).toEqual([
        {
          where: { id: 'u-1' },
          data: { email: 'nuevo@example.com', resetPasswordToken: null, resetPasswordExpires: null, codigoOTP: null, otpExpira: null },
        },
      ]);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('si el aviso al correo anterior falla, el cambio se mantiene y el log no lleva correos', async () => {
      const { prisma, enviados, servicio } = preparar({ avisoFalla: true });
      await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
      await expect(servicio.confirmar('u-1', enviados[0].codigo)).resolves.toMatchObject({ success: true, data: { email: 'nuevo@example.com' } });
      expect(prisma.usuarios[0].email).toBe('nuevo@example.com');
      expect(salidas.join('\n')).not.toContain('clienta@example.com');
      expect(salidas.join('\n')).not.toContain('nuevo@example.com');
    });

    it('si el código es incorrecto no se avisa ni se limpia nada', async () => {
      const { prisma, email, enviados, servicio } = preparar();
      await servicio.solicitar('u-1', 'nuevo@example.com', PASSWORD);
      const otro = enviados[0].codigo === '000000' ? '111111' : '000000';
      await expect(servicio.confirmar('u-1', otro)).rejects.toBeInstanceOf(BadRequestException);
      expect(email.sendAvisoCorreoCambiadoEmail).not.toHaveBeenCalled();
      expect(prisma.usuarios[0].resetPasswordToken).toBe('token-recuperacion-falso');
      expect(prisma.usuarios[0].codigoOTP).toBe('codigo-otp-falso');
    });
  });
});

describe('Rutas /auth/me/correo', () => {
  let app: INestApplication;
  let base: string;
  const cambioCorreo = { solicitar: jest.fn(), confirmar: jest.fn() };

  /** El JwtAuthGuard real necesita un JWT firmado; aquí la usuaria llega en un header de prueba. */
  const guardFalso: CanActivate = {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      if (!req.headers['x-usuaria']) throw new UnauthorizedException();
      req.user = { id: req.headers['x-usuaria'], rol: 'cliente' };
      return true;
    },
  };

  const limpiarLimites = () => {
    for (const h of [CambioCorreoController.prototype.solicitar, CambioCorreoController.prototype.confirmar]) {
      Reflect.getMetadata(GUARDS_METADATA, h).find((g: unknown) => g instanceof RateLimitGuard).requests.clear();
    }
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [CambioCorreoController],
      providers: [{ provide: CambioCorreoService, useValue: cambioCorreo }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    limpiarLimites();
    cambioCorreo.solicitar.mockReset().mockResolvedValue({ success: true, message: 'ok', vigenciaMinutos: 15 });
    cambioCorreo.confirmar.mockReset().mockResolvedValue({ success: true, data: { email: 'nuevo@example.com' } });
  });

  const post = (ruta: string, cuerpo: unknown, usuaria: string | null = 'u-1') =>
    fetch(`${base}/api/auth/me/correo/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(usuaria ? { 'x-usuaria': usuaria } : {}) },
      body: JSON.stringify(cuerpo),
    });

  it('rutas POST con sesión y límite de solicitudes como las vecinas', () => {
    const solicitar = CambioCorreoController.prototype.solicitar;
    const confirmar = CambioCorreoController.prototype.confirmar;
    expect(Reflect.getMetadata(PATH_METADATA, CambioCorreoController)).toBe('auth');
    expect(Reflect.getMetadata(PATH_METADATA, solicitar)).toBe('me/correo/solicitar');
    expect(Reflect.getMetadata(PATH_METADATA, confirmar)).toBe('me/correo/confirmar');
    expect(Reflect.getMetadata(METHOD_METADATA, solicitar)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, confirmar)).toBe(RequestMethod.POST);
    for (const [h, max] of [[solicitar, 3], [confirmar, 5]] as const) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, h);
      expect(guards[0]).toBe(JwtAuthGuard);
      const limite = guards.find((g: unknown) => g instanceof RateLimitGuard);
      expect(limite.maxRequests).toBe(max);
      expect(limite.windowMs).toBe(60000);
    }
  });

  it('registrados en AuthModule (controlador, servicio y EmailModule)', () => {
    expect(Reflect.getMetadata('controllers', AuthModule)).toContain(CambioCorreoController);
    expect(Reflect.getMetadata('providers', AuthModule)).toContain(CambioCorreoService);
    expect(Reflect.getMetadata('imports', AuthModule)).toContain(EmailModule);
  });

  it('sin sesión: 401', async () => {
    expect((await post('solicitar', { correoNuevo: 'nuevo@example.com' }, null)).status).toBe(401);
    expect((await post('confirmar', { codigo: '123456' }, null)).status).toBe(401);
  });

  it('solicitar: correo con formato inválido es 400 en español; válido llega al servicio con la usuaria', async () => {
    const malo = await post('solicitar', { correoNuevo: 'no-es-correo' });
    expect(malo.status).toBe(400);
    expect(JSON.stringify(await malo.json())).toContain('Escribe un correo válido.');
    const bueno = await post('solicitar', { correoNuevo: 'nuevo@example.com' });
    expect(bueno.status).toBe(200);
    expect(cambioCorreo.solicitar).toHaveBeenCalledWith('u-1', 'nuevo@example.com', undefined);
  });

  it('solicitar acepta passwordActual y la pasa al servicio; si no es texto, 400 en español', async () => {
    const bueno = await post('solicitar', { correoNuevo: 'nuevo@example.com', passwordActual: PASSWORD });
    expect(bueno.status).toBe(200);
    expect(cambioCorreo.solicitar).toHaveBeenCalledWith('u-1', 'nuevo@example.com', PASSWORD);
    cambioCorreo.solicitar.mockClear();
    const malo = await post('solicitar', { correoNuevo: 'nuevo@example.com', passwordActual: 12345 });
    expect(malo.status).toBe(400);
    expect(JSON.stringify(await malo.json())).toContain('La contraseña actual debe ser texto.');
    expect(cambioCorreo.solicitar).not.toHaveBeenCalled();
  });

  it('solicitar con contraseña incorrecta responde 400 con el mensaje y el código del servicio (no 401)', async () => {
    cambioCorreo.solicitar.mockRejectedValueOnce(
      new BadRequestException({ message: 'La contraseña actual no es correcta.', code: 'PASSWORD_ACTUAL_INCORRECTA' }),
    );
    const r = await post('solicitar', { correoNuevo: 'nuevo@example.com', passwordActual: 'OtraClaveFicticia-9' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ message: 'La contraseña actual no es correcta.', code: 'PASSWORD_ACTUAL_INCORRECTA' });
  });

  it('confirmar: el código debe tener 6 dígitos; válido llega al servicio y responde el correo nuevo', async () => {
    const malo = await post('confirmar', { codigo: '12ab' });
    expect(malo.status).toBe(400);
    expect(JSON.stringify(await malo.json())).toContain('El código tiene 6 dígitos.');
    const bueno = await post('confirmar', { codigo: '123456' });
    expect(bueno.status).toBe(200);
    expect(await bueno.json()).toMatchObject({ data: { email: 'nuevo@example.com' } });
    expect(cambioCorreo.confirmar).toHaveBeenCalledWith('u-1', '123456', undefined);
  });

  it('confirmar acepta codigoActual (cuentas sin contraseña) y lo pasa al servicio; con otro formato, 400 en español', async () => {
    const malo = await post('confirmar', { codigo: '123456', codigoActual: '12' });
    expect(malo.status).toBe(400);
    expect(JSON.stringify(await malo.json())).toContain('El código de tu correo actual tiene 6 dígitos.');
    const bueno = await post('confirmar', { codigo: '123456', codigoActual: '654321' });
    expect(bueno.status).toBe(200);
    expect(cambioCorreo.confirmar).toHaveBeenCalledWith('u-1', '123456', '654321');
  });
});
