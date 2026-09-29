import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { JWT_TTL_SEGUNDOS } from './jwt-ttl';

const jwtService = new JwtService({ secret: 'secreto-de-prueba' });

function vigencia(token: string): number {
  const { iat, exp } = jwtService.decode(token) as { iat: number; exp: number };
  return exp - iat;
}

describe('Vigencia del JWT', () => {
  it('es de 24 horas', () => {
    expect(JWT_TTL_SEGUNDOS).toBe(24 * 60 * 60);
  });

  it('Google OAuth y refresh (AuthService.generateToken) usan la vigencia común', async () => {
    const auth = new AuthService(jwtService, {} as any, {} as any, {} as any, {} as any);
    const token = await auth.generateToken({ id: 'u-1', email: 'u@example.com' });
    expect(vigencia(token)).toBe(JWT_TTL_SEGUNDOS);
  });

  it('el login con correo (UsuariosService.login) usa la misma vigencia', async () => {
    const password = await bcrypt.hash('Clave#Segura2026', 4);
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u-1',
          email: 'u@example.com',
          nombre: 'Usuario',
          rol: 'cliente',
          activo: true,
          confirmado: true,
          password,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const security = {
      isAccountLocked: jest.fn().mockResolvedValue({ locked: false }),
      resetFailedLoginAttempts: jest.fn().mockResolvedValue(undefined),
      recordFailedLoginAttempt: jest.fn(),
    };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const usuarios = new UsuariosService(prisma as any, {} as any, jwtService, security as any);

    const { token } = await usuarios.login({ email: 'u@example.com', password: 'Clave#Segura2026' });

    expect(vigencia(token)).toBe(JWT_TTL_SEGUNDOS);
    jest.restoreAllMocks();
  });

  it('ningún otro punto del código firma o registra el JWT con una vigencia propia', () => {
    const src = join(__dirname, '..');
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts')) archivos.push(ruta);
      }
    };
    recorrer(src);

    const distintos = archivos.flatMap((ruta) =>
      readFileSync(ruta, 'utf8')
        .split('\n')
        .filter((linea) => /\bexpiresIn\s*:/.test(linea) && !linea.includes('JWT_TTL_SEGUNDOS'))
        .map((linea) => `${ruta}: ${linea.trim()}`),
    );
    expect(distintos).toEqual([]);
  });
});
