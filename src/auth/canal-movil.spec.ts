import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SecurityService } from '../common/services/security.service';
import { UsuariosService } from '../usuarios/usuarios.service';

/**
 * Canal movil en el login, el canje de Google, /auth/refresh, logout y JwtStrategy.
 * La web (cookie) y el personal no cambian.
 */

const jwt = new JwtService({ secret: 'secreto-falso-solo-para-pruebas' });
const SESION_MOVIL = {
  token: 'token-acceso-movil',
  refreshToken: 'token-renovacion-falso',
  refreshExpiraEn: '2026-11-06T12:00:00.000Z',
};

function authCon(rol: string) {
  const usuariosService = {
    login: jest.fn().mockResolvedValue({
      success: true,
      message: 'Inicio de sesión exitoso',
      token: 'token-web-24h',
      usuario: { id: 'u-1', nombre: 'Persona', email: 'p@example.com', rol },
    }),
  };
  const prisma = {
    usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1', email: 'p@example.com', rol, activo: true, confirmado: true }) },
    codigoOAuth: {
      findUnique: jest.fn().mockResolvedValue({ codigo: 'c', usado: false, expiraEn: new Date(Date.now() + 60_000), token: jwt.sign({ id: 'u-1', email: 'p@example.com' }) }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const security = {
    updateLastActivity: jest.fn().mockResolvedValue(undefined),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
    revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
    revokeToken: jest.fn().mockResolvedValue(undefined),
  };
  const sesiones = {
    emitir: jest.fn().mockResolvedValue(SESION_MOVIL),
    revocarPorToken: jest.fn().mockResolvedValue(undefined),
  };
  const auth = new AuthService(jwt, prisma as any, usuariosService as any, security as any, {} as any, sesiones as any);
  return { auth, usuariosService, sesiones, security, prisma };
}

describe('Canal movil', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('POST /auth/login', () => {
    it('clienta en Bearer con canal movil: token corto, refreshToken y refreshExpiraEn', async () => {
      const { auth, sesiones } = authCon('cliente');
      const r: any = await auth.login({ email: 'p@example.com', password: 'x', canal: 'movil', dispositivo: 'Pixel 8' } as any, false);
      expect(sesiones.emitir).toHaveBeenCalledWith({ id: 'u-1', email: 'p@example.com' }, 'Pixel 8');
      expect(r).toMatchObject({ success: true, ...SESION_MOVIL, usuario: { rol: 'cliente' } });
    });

    it.each(['admin', 'estilista', 'empleado', 'becario'])('rol %s con canal movil: se ignora, sesión de siempre', async (rol) => {
      const { auth, sesiones } = authCon(rol);
      const r: any = await auth.login({ email: 'p@example.com', password: 'x', canal: 'movil' } as any, false);
      expect(sesiones.emitir).not.toHaveBeenCalled();
      expect(r.token).toBe('token-web-24h');
      expect(r.refreshToken).toBeUndefined();
    });

    it('modo cookie (web) con canal movil: se ignora', async () => {
      const { auth, sesiones } = authCon('cliente');
      const r: any = await auth.login({ email: 'p@example.com', password: 'x', canal: 'movil' } as any, true);
      expect(sesiones.emitir).not.toHaveBeenCalled();
      expect(r.token).toBe('token-web-24h');
    });

    it('sin canal: igual que hoy', async () => {
      const { auth, sesiones } = authCon('cliente');
      const r: any = await auth.login({ email: 'p@example.com', password: 'x' } as any, false);
      expect(sesiones.emitir).not.toHaveBeenCalled();
      expect(r.refreshToken).toBeUndefined();
    });
  });

  describe('POST /auth/exchange-code (Google)', () => {
    it('clienta en Bearer con canal movil: sesión móvil', async () => {
      const { auth, sesiones } = authCon('cliente');
      const r: any = await auth.intercambiarCodigoPorToken('c', { canal: 'movil', enCookie: false });
      expect(sesiones.emitir).toHaveBeenCalledWith({ id: 'u-1', email: 'p@example.com' }, undefined);
      expect(r).toMatchObject(SESION_MOVIL);
    });

    it('personal o cookie: el token de siempre', async () => {
      const personal = authCon('admin');
      expect((await personal.auth.intercambiarCodigoPorToken('c', { canal: 'movil', enCookie: false }) as any).refreshToken).toBeUndefined();
      const web = authCon('cliente');
      expect((await web.auth.intercambiarCodigoPorToken('c', { canal: 'movil', enCookie: true }) as any).refreshToken).toBeUndefined();
      expect(personal.sesiones.emitir).not.toHaveBeenCalled();
      expect(web.sesiones.emitir).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    it('con un token movil responde 400 USA_RENOVAR_MOVIL', async () => {
      const { auth } = authCon('cliente');
      const token = jwt.sign({ id: 'u-1', email: 'p@example.com', canal: 'movil', sid: 's-1' }, { expiresIn: 900 });
      try {
        await auth.refreshToken(token, { id: 'u-1' });
        throw new Error('se esperaba un error');
      } catch (e: any) {
        expect(e.getStatus()).toBe(400);
        expect(e.getResponse()).toMatchObject({ code: 'USA_RENOVAR_MOVIL' });
      }
    });
  });

  describe('POST /auth/logout', () => {
    it('con refreshToken revoca esa sesión móvil además del cierre de siempre', async () => {
      const { auth, sesiones, security } = authCon('cliente');
      const token = jwt.sign({ id: 'u-1', email: 'p@example.com', canal: 'movil', sid: 's-1' }, { expiresIn: 900 });
      await auth.logout(token, false, 'token-renovacion-falso');
      expect(sesiones.revocarPorToken).toHaveBeenCalledWith('token-renovacion-falso', 'u-1');
      expect(security.revokeAllUserTokens).toHaveBeenCalledWith('u-1');
    });

    it('si falla revocar la sesión móvil, el cierre global ya quedó hecho y responde bien', async () => {
      const { auth, sesiones, security } = authCon('cliente');
      sesiones.revocarPorToken.mockRejectedValueOnce(new Error('base caída'));
      const token = jwt.sign({ id: 'u-1', email: 'p@example.com' }, { expiresIn: 900 });
      await expect(auth.logout(token, false, 'token-renovacion-falso')).resolves.toMatchObject({ success: true });
      expect(security.revokeAllUserTokens).toHaveBeenCalledWith('u-1');
    });

    it('sin refreshToken no toca sesiones móviles por token', async () => {
      const { auth, sesiones } = authCon('cliente');
      const token = jwt.sign({ id: 'u-1', email: 'p@example.com' }, { expiresIn: 900 });
      await auth.logout(token, false);
      expect(sesiones.revocarPorToken).not.toHaveBeenCalled();
    });
  });

  describe('JwtStrategy', () => {
    function estrategia(inactivo: boolean, { rol = 'cliente', familiaViva = true } = {}) {
      const seguridad = {
        isTokenRevoked: jest.fn().mockResolvedValue(false),
        isTokenRevokedByGlobalLogout: jest.fn().mockResolvedValue(false),
        isUserInactive: jest.fn().mockResolvedValue(inactivo),
        updateLastActivity: jest.fn().mockResolvedValue(undefined),
      };
      const prisma = {
        usuario: { findUnique: jest.fn().mockResolvedValue({ rol }) },
        sesionMovil: { findFirst: jest.fn().mockResolvedValue(familiaViva ? { id: 's-2' } : null) },
      };
      const s = new JwtStrategy({ get: () => 'secreto-falso-solo-para-pruebas' } as any, seguridad as any, prisma as any);
      return { s, seguridad, prisma };
    }
    const req = (token: string) => ({ rawToken: token }) as any;
    const movil = () => ({ id: 'u-1', email: 'p@example.com', iat: Math.floor(Date.now() / 1000), canal: 'movil', sid: 's-1', fam: 'f-1' });

    it('token movil con más de 15 min sin actividad: se acepta y no escribe ultimaActividad', async () => {
      const inmediato = jest.spyOn(global, 'setImmediate');
      const { s, seguridad, prisma } = estrategia(true);
      const r = await s.validate(req('t'), movil());
      expect(r).toMatchObject({ id: 'u-1', rol: 'cliente' });
      expect(seguridad.isUserInactive).not.toHaveBeenCalled();
      expect(inmediato).not.toHaveBeenCalled();
      expect(seguridad.updateLastActivity).not.toHaveBeenCalled();
      expect(prisma.sesionMovil.findFirst).toHaveBeenCalledWith({
        where: { familiaId: 'f-1', usuarioId: 'u-1', revocadaEn: null },
        select: { id: true },
      });
    });

    it('token movil sigue respetando la lista de revocados y tokensRevocadosDesde', async () => {
      const { s, seguridad } = estrategia(false);
      seguridad.isTokenRevokedByGlobalLogout.mockResolvedValueOnce(true);
      await expect(s.validate(req('t'), movil())).rejects.toThrow('Sesión cerrada');
      seguridad.isTokenRevoked.mockResolvedValueOnce(true);
      await expect(s.validate(req('t'), movil())).rejects.toThrow('Token revocado');
    });

    it('token movil cuya sesión ya se cerró (logout, reuso, logoutAll): 401 al momento', async () => {
      const { s } = estrategia(false, { familiaViva: false });
      await expect(s.validate(req('t'), movil())).rejects.toThrow('Sesión cerrada');
    });

    it('token movil sin familia: 401', async () => {
      const { s } = estrategia(false);
      const { fam: _sinFamilia, ...sinFam } = movil();
      await expect(s.validate(req('t'), sinFam)).rejects.toThrow('Sesión cerrada');
    });

    it('token movil de una cuenta que ya no es clienta: 401 (no hereda permisos de personal)', async () => {
      const { s } = estrategia(false, { rol: 'estilista' });
      await expect(s.validate(req('t'), movil())).rejects.toThrow('Sesión cerrada');
    });

    it('el personal y la web no consultan sesiones móviles', async () => {
      const { s, prisma } = estrategia(false, { rol: 'admin' });
      await expect(s.validate(req('t'), { id: 'u-1', iat: Math.floor(Date.now() / 1000), lastActivity: 1 })).resolves.toMatchObject({ rol: 'admin' });
      expect(prisma.sesionMovil.findFirst).not.toHaveBeenCalled();
    });

    it('token de la web con 15 min sin actividad: sigue rechazado', async () => {
      const { s } = estrategia(true);
      await expect(
        s.validate(req('t'), { id: 'u-1', iat: Math.floor(Date.now() / 1000), lastActivity: 1 }),
      ).rejects.toThrow('inactividad');
    });
  });

  describe('Recuperación de contraseña (olvidé mi contraseña)', () => {
    it('cierra todas las sesiones: tokensRevocadosDesde en la misma escritura y sesiones móviles revocadas', async () => {
      const usuario = { id: 'u-1', nombre: 'Persona', email: 'p@example.com', telefono: null, fechaNacimiento: null, password: null };
      const prisma = {
        usuario: { findFirst: jest.fn().mockResolvedValue(usuario), update: jest.fn().mockResolvedValue({}) },
        sesionMovil: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      const servicio = new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
      await servicio.cambiarPassword('p@example.com', 'token-recuperacion-falso', 'Otra$Llave47');
      expect(prisma.usuario.update.mock.calls[0][0].data).toMatchObject({
        resetPasswordToken: null,
        confirmado: true,
        tokensRevocadosDesde: expect.any(Date),
      });
      expect(prisma.sesionMovil.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'u-1', revocadaEn: null },
        data: { revocadaEn: expect.any(Date) },
      });
    });
  });

  describe('revokeAllUserTokens (logoutAll, logout)', () => {
    it('también marca revocadas todas las sesiones móviles de la cuenta', async () => {
      const prisma = {
        usuario: { update: jest.fn().mockResolvedValue({}) },
        sesionMovil: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      };
      const seguridad = new SecurityService(prisma as any);
      await seguridad.revokeAllUserTokens('u-1');
      expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { tokensRevocadosDesde: expect.any(Date) } });
      expect(prisma.sesionMovil.updateMany).toHaveBeenCalledWith({
        where: { usuarioId: 'u-1', revocadaEn: null },
        data: { revocadaEn: expect.any(Date) },
      });
    });
  });
});
