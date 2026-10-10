import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { CODIGO_CUENTA_NO_ACTIVADA, UsuariosService } from './usuarios.service';

const MENSAJE = 'Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.';
const PASSWORD = 'Clave#Segura2026';

async function servicioCon(extra: Record<string, unknown>) {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'u@example.com',
        nombre: 'Usuaria',
        rol: 'cliente',
        activo: true,
        password: await bcrypt.hash(PASSWORD, 4),
        ...extra,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const security = {
    isAccountLocked: jest.fn().mockResolvedValue({ locked: false }),
    resetFailedLoginAttempts: jest.fn().mockResolvedValue(undefined),
    recordFailedLoginAttempt: jest.fn(),
  };
  return new UsuariosService(prisma as any, {} as any, new JwtService({ secret: 'secreto-de-prueba' }), security as any);
}

/** Pasa la excepción por el filtro global y devuelve el cuerpo que recibe el cliente. */
function cuerpoDelFiltro(exception: unknown) {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/api/auth/login' }) }) } as any;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] as Record<string, unknown> };
}

describe('Login con cuenta sin activar', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('responde 403 con code CUENTA_NO_ACTIVADA y el mismo mensaje', async () => {
    const servicio = await servicioCon({ confirmado: false, googleId: null });
    const error = await servicio.login({ email: 'u@example.com', password: PASSWORD }).catch((e) => e);

    expect(CODIGO_CUENTA_NO_ACTIVADA).toBe('CUENTA_NO_ACTIVADA');
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(MENSAJE);

    const { status, body } = cuerpoDelFiltro(error);
    expect(status).toBe(403);
    expect(body.message).toBe(MENSAJE);
    expect(body.code).toBe('CUENTA_NO_ACTIVADA');
  });

  it('una cuenta de Google sin confirmar sí entra', async () => {
    const servicio = await servicioCon({ confirmado: false, googleId: 'g-1' });
    const r = await servicio.login({ email: 'u@example.com', password: PASSWORD });
    expect(r.token).toEqual(expect.any(String));
  });
});
