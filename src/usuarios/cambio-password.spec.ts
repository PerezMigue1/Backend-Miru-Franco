import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsuariosService } from './usuarios.service';

/**
 * Cambio de contraseña con código por correo (POST /auth/me/password/codigo y POST /auth/me/password).
 * Prisma y el correo van simulados: no se toca la base ni se envía ningún correo real.
 */

const SECRETO_FALSO = 'secreto-falso-solo-para-pruebas';
const ACTUAL = 'Vieja#Clave92';
const NUEVA = 'Otra$Llave47';
const ID = 'usuario-de-prueba';

type Fila = Record<string, any>;

function crearEscenario(fila: Partial<Fila> = {}) {
  const usuario: Fila = {
    id: ID,
    nombre: 'Clienta Prueba',
    email: 'clienta.prueba@example.com',
    telefono: '7710000000',
    fechaNacimiento: new Date('1990-05-20T00:00:00Z'),
    password: bcrypt.hashSync(ACTUAL, 4),
    confirmado: true,
    codigoOTP: null,
    otpExpira: null,
    tokensRevocadosDesde: null,
    ...fila,
  };
  const coincide = (where: Fila) =>
    Object.entries(where).every(([k, v]) => usuario[k] === v);
  const prisma = {
    usuario: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === usuario.id || (where.email && where.email === usuario.email) ? { ...usuario } : null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        if (where.id !== usuario.id) throw new Error('no existe');
        Object.assign(usuario, data);
        return { ...usuario };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!coincide(where)) return { count: 0 };
        Object.assign(usuario, data);
        return { count: 1 };
      }),
    },
  };
  const correos: { codigo: string[]; aviso: string[] } = { codigo: [], aviso: [] };
  const emailService = {
    sendCodigoCambioPasswordEmail: jest.fn(async (_correo: string, codigo: string) => {
      correos.codigo.push(codigo);
    }),
    sendAvisoPasswordCambiadaEmail: jest.fn(async (_correo: string, fechaHora: string) => {
      correos.aviso.push(fechaHora);
    }),
  };
  const security = { revokeAllUserTokens: jest.fn() };
  const servicio = new UsuariosService(prisma as any, emailService as any, {} as any, security as any);
  return { servicio, usuario, prisma, emailService, correos };
}

/** Captura el error lanzado y devuelve { status, body } como lo vería el filtro global. */
async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e: any) {
    return { status: e.getStatus?.(), body: e.getResponse?.() };
  }
  throw new Error('se esperaba un error');
}

const textoDe = (x: unknown) => JSON.stringify(x);

describe('Cambio de contraseña con código por correo', () => {
  const salidas: string[] = [];
  const capturar = (...args: unknown[]) => {
    salidas.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  beforeEach(() => {
    process.env.JWT_SECRET = SECRETO_FALSO;
    salidas.length = 0;
    for (const metodo of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      jest.spyOn(console, metodo).mockImplementation(capturar);
    }
    for (const metodo of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, metodo).mockImplementation(capturar as any);
    }
  });

  afterEach(() => jest.restoreAllMocks());

  describe('paso 1: pedir el código', () => {
    it('cuenta sin contraseña (Google): 409 CUENTA_SIN_PASSWORD y no envía nada', async () => {
      const { servicio, emailService } = crearEscenario({ password: null, googleId: 'g-123' });
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, ACTUAL));
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({
        code: 'CUENTA_SIN_PASSWORD',
        message: 'Tu cuenta entra con Google y no tiene contraseña.',
      });
      expect(emailService.sendCodigoCambioPasswordEmail).not.toHaveBeenCalled();
    });

    it('cuenta sin confirmar: 409 CUENTA_NO_CONFIRMADA (los campos del código son de la activación)', async () => {
      const { servicio, usuario } = crearEscenario({ confirmado: false, codigoOTP: '123456' });
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, ACTUAL));
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'CUENTA_NO_CONFIRMADA' });
      expect(usuario.codigoOTP).toBe('123456');
    });

    it('contraseña actual incorrecta: 400 PASSWORD_ACTUAL_INCORRECTA (no 401) y no envía nada', async () => {
      const { servicio, emailService } = crearEscenario();
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, 'NoEsLaClave#1'));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({
        code: 'PASSWORD_ACTUAL_INCORRECTA',
        message: 'La contraseña actual no es correcta.',
      });
      expect(emailService.sendCodigoCambioPasswordEmail).not.toHaveBeenCalled();
    });

    it('envía un código de 6 dígitos al correo de la cuenta, guarda solo su hash con 10 minutos y responde sin el código', async () => {
      const { servicio, usuario, emailService, correos } = crearEscenario();
      const antes = Date.now();
      const respuesta = await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);

      expect(emailService.sendCodigoCambioPasswordEmail).toHaveBeenCalledWith('clienta.prueba@example.com', expect.any(String), 10);
      const [codigo] = correos.codigo;
      expect(codigo).toMatch(/^\d{6}$/);

      expect(respuesta).toMatchObject({ success: true, vigenciaMinutos: 10 });
      expect(textoDe(respuesta)).not.toContain(codigo);

      // cp1:<intentos>:<códigos pedidos en la hora>:<inicio de la hora, en segundos>:<hmac>
      expect(usuario.codigoOTP).toMatch(/^cp1:0:1:\d+:[0-9a-f]{64}$/);
      expect(usuario.codigoOTP).not.toContain(codigo);
      const vence = (usuario.otpExpira as Date).getTime();
      expect(vence).toBeGreaterThanOrEqual(antes + 10 * 60_000 - 1000);
      expect(vence).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);

      expect(salidas.join('\n')).not.toContain(codigo);
    });

    it('un código nuevo invalida el anterior', async () => {
      const { servicio, correos } = crearEscenario();
      await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
      await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
      const [primero, segundo] = correos.codigo;
      if (primero === segundo) return; // 1 en un millón: mismo código dos veces
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, primero));
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
      await expect(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, segundo)).resolves.toMatchObject({ success: true });
    });

    it('si el correo no sale, el código queda inservible y responde 502 sin datos de la cuenta en los logs', async () => {
      const { servicio, usuario, emailService } = crearEscenario();
      emailService.sendCodigoCambioPasswordEmail.mockRejectedValueOnce(new Error('No se pudo enviar el correo'));
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, ACTUAL));
      expect(r.status).toBe(502);
      expect(r.body).toMatchObject({ code: 'CORREO_NO_ENVIADO' });
      expect(usuario.codigoOTP).toMatch(/^cp1:5:1:/);
      expect(salidas.join('\n')).not.toContain('clienta.prueba@example.com');
      // Se puede pedir otro.
      await expect(servicio.solicitarCodigoCambioPassword(ID, ACTUAL)).resolves.toMatchObject({ success: true });
    });

    it('tope por cuenta: el sexto código dentro de una hora responde 429 DEMASIADOS_CODIGOS y no envía correo', async () => {
      const { servicio, emailService } = crearEscenario();
      for (let i = 0; i < 5; i++) await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, ACTUAL));
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({ code: 'DEMASIADOS_CODIGOS' });
      expect(emailService.sendCodigoCambioPasswordEmail).toHaveBeenCalledTimes(5);
    });

    it('pedir otro código no reinicia el tope: 5 códigos con 5 fallos cada uno y después 429', async () => {
      const { servicio, correos } = crearEscenario();
      for (let c = 0; c < 5; c++) {
        await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
        const codigo = correos.codigo[c];
        const malo = codigo === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, malo));
      }
      const r = await errorDe(servicio.solicitarCodigoCambioPassword(ID, ACTUAL));
      expect(r.body).toMatchObject({ code: 'DEMASIADOS_CODIGOS' });
    });

    it('pasada la hora se puede volver a pedir', async () => {
      const { servicio } = crearEscenario();
      for (let i = 0; i < 5; i++) await servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
      const ahora = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(ahora + 61 * 60_000);
      await expect(servicio.solicitarCodigoCambioPassword(ID, ACTUAL)).resolves.toMatchObject({ success: true });
    });

    it('dos pedidos al mismo tiempo cuentan los dos (o uno se rechaza): no se cuelan códigos de más', async () => {
      const { servicio, usuario, emailService } = crearEscenario();
      const resultados = await Promise.allSettled([
        servicio.solicitarCodigoCambioPassword(ID, ACTUAL),
        servicio.solicitarCodigoCambioPassword(ID, ACTUAL),
      ]);
      const enviados = emailService.sendCodigoCambioPasswordEmail.mock.calls.length;
      const pedidos = Number(/^cp1:\d+:(\d+):/.exec(usuario.codigoOTP)![1]);
      expect(pedidos).toBe(enviados);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(enviados);
    });
  });

  describe('paso 2: cambiar la contraseña con el código', () => {
    async function conCodigo(fila: Partial<Fila> = {}) {
      const escenario = crearEscenario(fila);
      await escenario.servicio.solicitarCodigoCambioPassword(ID, ACTUAL);
      return { ...escenario, codigo: escenario.correos.codigo[0] };
    }
    const otroCodigo = (codigo: string) => (codigo === '000000' ? '111111' : '000000');

    it('cambia la contraseña, borra el código, revoca todas las sesiones y avisa por correo', async () => {
      const { servicio, usuario, codigo, emailService, correos } = await conCodigo();
      const antes = Date.now();
      const respuesta = await servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo);

      expect(respuesta).toEqual({ success: true, message: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
      expect(bcrypt.compareSync(NUEVA, usuario.password)).toBe(true);
      expect(usuario.codigoOTP).toBeNull();
      expect(usuario.otpExpira).toBeNull();
      // Mismo mecanismo que logoutAll: todo token con iat anterior queda revocado, incluido el de esta petición.
      expect((usuario.tokensRevocadosDesde as Date).getTime()).toBeGreaterThanOrEqual(antes);

      expect(emailService.sendAvisoPasswordCambiadaEmail).toHaveBeenCalledWith('clienta.prueba@example.com', expect.any(String));
      const [fechaHora] = correos.aviso;
      expect(fechaHora).toMatch(/\d{4}/);
      expect(textoDe(emailService.sendAvisoPasswordCambiadaEmail.mock.calls)).not.toContain(NUEVA);
      expect(salidas.join('\n')).not.toContain(codigo);
      expect(salidas.join('\n')).not.toContain(NUEVA);
    });

    it('el código no se puede usar dos veces', async () => {
      const { servicio, codigo } = await conCodigo();
      await servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo);
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, NUEVA, 'Tercera%Llave58', codigo));
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
    });

    it('si el aviso por correo falla, el cambio se mantiene y solo se registra el error sin datos personales', async () => {
      const { servicio, usuario, codigo, emailService } = await conCodigo();
      emailService.sendAvisoPasswordCambiadaEmail.mockRejectedValueOnce(new Error('No se pudo enviar el correo'));
      await expect(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo)).resolves.toMatchObject({ success: true });
      expect(bcrypt.compareSync(NUEVA, usuario.password)).toBe(true);
      const log = salidas.join('\n');
      expect(log).toMatch(/aviso/i);
      expect(log).not.toContain('clienta.prueba@example.com');
      expect(log).not.toContain('Clienta Prueba');
    });

    it('código incorrecto: 400 CODIGO_INVALIDO y cuenta el intento', async () => {
      const { servicio, usuario, codigo } = await conCodigo();
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, otroCodigo(codigo)));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO', message: 'El código no es válido o ya venció.' });
      expect(usuario.codigoOTP).toMatch(/^cp1:1:/);
      expect(bcrypt.compareSync(ACTUAL, usuario.password)).toBe(true);
    });

    it('código con otro formato: 400 CODIGO_INVALIDO', async () => {
      const { servicio } = await conCodigo();
      for (const malo of ['12345', '1234567', 'abcdef', ' 123456 x']) {
        const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, malo));
        expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
      }
    });

    it('código vencido: 400 CODIGO_INVALIDO aunque sea el correcto', async () => {
      const { servicio, usuario, codigo } = await conCodigo();
      usuario.otpExpira = new Date(Date.now() - 1000);
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo));
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
      expect(bcrypt.compareSync(ACTUAL, usuario.password)).toBe(true);
    });

    it('sin código pedido: 400 CODIGO_INVALIDO', async () => {
      const { servicio } = crearEscenario();
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, '123456'));
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
    });

    it('tras 5 intentos fallidos el código se invalida: ni el correcto sirve y hay que pedir otro', async () => {
      const { servicio, usuario, codigo } = await conCodigo();
      for (let i = 0; i < 5; i++) {
        const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, otroCodigo(codigo)));
        expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
      }
      // Queda registrado (inservible) para que pedir otro no reinicie el tope de la hora.
      expect(usuario.codigoOTP).toMatch(/^cp1:5:/);
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo));
      expect(r.body).toMatchObject({ code: 'CODIGO_INVALIDO' });
      expect(bcrypt.compareSync(ACTUAL, usuario.password)).toBe(true);
    });

    it('vuelve a validar la contraseña actual: 400 PASSWORD_ACTUAL_INCORRECTA sin gastar el código', async () => {
      const { servicio, usuario, codigo } = await conCodigo();
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, 'NoEsLaClave#1', NUEVA, codigo));
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ code: 'PASSWORD_ACTUAL_INCORRECTA' });
      expect(usuario.codigoOTP).toMatch(/^cp1:0:/);
    });

    it('cuenta sin contraseña: 409 CUENTA_SIN_PASSWORD', async () => {
      const { servicio } = crearEscenario({ password: null });
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, '123456'));
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'CUENTA_SIN_PASSWORD' });
    });

    it('la nueva igual a la actual: mismo mensaje de hoy, sin gastar el código', async () => {
      const { servicio, usuario, codigo } = await conCodigo();
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, ACTUAL, codigo));
      expect(r.status).toBe(400);
      expect(textoDe(r.body)).toContain('La nueva contraseña no puede ser igual a la contraseña actual');
      expect(usuario.codigoOTP).toMatch(/^cp1:0:/);
    });

    it('la nueva con datos personales: mismo mensaje de hoy', async () => {
      const { servicio, codigo } = await conCodigo();
      const r = await errorDe(servicio.cambiarPasswordConCodigo(ID, ACTUAL, 'Llave#1990Ok', codigo));
      expect(r.status).toBe(400);
      expect(textoDe(r.body)).toContain('La contraseña no puede contener datos personales');
    });

    it('POST /auth/verificar-otp (activación) no ve el código de cambio: responde como si no hubiera código', async () => {
      const { servicio, usuario } = await conCodigo();
      const r = await errorDe(servicio.verificarOTP({ email: usuario.email, codigo: usuario.codigoOTP } as any));
      expect(r.status).toBe(400);
      expect(textoDe(r.body)).toContain('No hay código activo. Solicita uno nuevo.');
      expect(usuario.codigoOTP).toMatch(/^cp1:0:/);
    });

    it('dos intentos al mismo tiempo con el código correcto: solo uno cambia la contraseña', async () => {
      const { servicio, codigo } = await conCodigo();
      const resultados = await Promise.allSettled([
        servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo),
        servicio.cambiarPasswordConCodigo(ID, ACTUAL, NUEVA, codigo),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
