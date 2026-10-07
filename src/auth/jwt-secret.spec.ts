import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { jwtSecretObligatorio } from './jwt-secret';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

/** JWT_SECRET es obligatorio: sin él (o vacío) el arranque falla con un mensaje claro y sin valores. */
describe('JWT_SECRET obligatorio', () => {
  const SECRETO_FALSO = 'secreto-falso-solo-para-pruebas';

  it.each([undefined, null, '', '   '])('falta o vacío (%p): lanza un error que nombra la variable', (valor) => {
    expect(() => jwtSecretObligatorio(valor as any)).toThrow(/JWT_SECRET/);
  });

  it('el mensaje no incluye el valor recibido', () => {
    try {
      jwtSecretObligatorio('   ');
    } catch (e: any) {
      expect(e.message).toMatch(/^Falta la variable de entorno JWT_SECRET/);
      return;
    }
    throw new Error('se esperaba un error');
  });

  it('con valor lo devuelve tal cual', () => {
    expect(jwtSecretObligatorio(SECRETO_FALSO)).toBe(SECRETO_FALSO);
  });

  it('JwtStrategy no arranca sin JWT_SECRET', () => {
    expect(() => new JwtStrategy({ get: () => undefined } as any, {} as any, {} as any)).toThrow(/JWT_SECRET/);
  });

  it('UsuariosModule (firma del login) no arranca sin JWT_SECRET', async () => {
    const anterior = process.env.JWT_SECRET;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // Los RateLimitGuard del controlador arrancan un setInterval al importarse: unref para que Jest termine.
    const setIntervalOriginal = global.setInterval;
    jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
        setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { UsuariosModule } = require('../usuarios/usuarios.module');
      // @prisma/client carga el .env del proyecto al importarse: se borra después del require.
      delete process.env.JWT_SECRET;
      // PrismaClient también lee el .env al construirse: se sustituye (este arranque no necesita base).
      await expect(
        Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), UsuariosModule] })
          .overrideProvider(PrismaService)
          .useValue({})
          .compile(),
      ).rejects.toThrow(/JWT_SECRET/);
    } finally {
      if (anterior !== undefined) process.env.JWT_SECRET = anterior;
      else delete process.env.JWT_SECRET;
      jest.restoreAllMocks();
    }
  });

  it('ningún módulo conserva el respaldo y los tres usan jwtSecretObligatorio', () => {
    // Armado por partes para que un grep del respaldo en src no encuentre esta prueba.
    const respaldoViejo = ['tu', 'secreto', 'temporal'].join('_');
    for (const archivo of ['auth/auth.module.ts', 'auth/strategies/jwt.strategy.ts', 'usuarios/usuarios.module.ts']) {
      const fuente = readFileSync(join(__dirname, '..', archivo), 'utf8');
      expect(fuente).not.toContain(respaldoViejo);
      expect(fuente).toContain('jwtSecretObligatorio(');
    }
  });
});
