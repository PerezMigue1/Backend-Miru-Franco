import { UnauthorizedException } from '@nestjs/common';
import { GRACIA_ROTACION_MS, SecurityService } from './security.service';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';

/** Prisma en memoria: tokens_revocados (token único) y usuarios.tokensRevocadosDesde. */
function prismaEnMemoria() {
  const revocados = new Map<string, { token: string; expiraEn: Date; creadoEn: Date }>();
  const usuarios = new Map<string, { tokensRevocadosDesde: Date | null }>([['u-1', { tokensRevocadosDesde: null }]]);
  return {
    revocados,
    tokenRevocado: {
      findUnique: jest.fn(async ({ where }: any) => revocados.get(where.token) ?? null),
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        let count = 0;
        for (const fila of data) {
          if (revocados.has(fila.token)) {
            if (!skipDuplicates) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
            continue;
          }
          revocados.set(fila.token, { ...fila });
          count++;
        }
        return { count };
      }),
      delete: jest.fn(async ({ where }: any) => revocados.delete(where.token)),
    },
    usuario: {
      update: jest.fn(async ({ where, data }: any) => Object.assign(usuarios.get(where.id)!, data)),
      findUnique: jest.fn(async ({ where }: any) => usuarios.get(where.id) ?? null),
    },
  };
}

const T0 = new Date('2026-10-02T12:00:00.000Z').getTime();
const EXPIRA = new Date(T0 + 15 * 60 * 1000);

describe('Rotación del token en el refresh: 30 s de gracia; el logout revoca al instante', () => {
  let prisma: ReturnType<typeof prismaEnMemoria>;
  let seguridad: SecurityService;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    prisma = prismaEnMemoria();
    seguridad = new SecurityService(prisma as any);
  });
  afterEach(() => jest.useRealTimers());

  it('la gracia es de 30 segundos', () => {
    expect(GRACIA_ROTACION_MS).toBe(30_000);
  });

  it('el token viejo funciona a los 5 s de rotarlo', async () => {
    await seguridad.revokeToken('viejo', EXPIRA);
    jest.setSystemTime(T0 + 5_000);
    await expect(seguridad.isTokenRevoked('viejo')).resolves.toBe(false);
  });

  it('el token viejo se rechaza a los 31 s', async () => {
    await seguridad.revokeToken('viejo', EXPIRA);
    jest.setSystemTime(T0 + 31_000);
    await expect(seguridad.isTokenRevoked('viejo')).resolves.toBe(true);
  });

  it('dos pestañas que refrescan con el mismo token no fallan ni alargan la gracia', async () => {
    await seguridad.revokeToken('viejo', EXPIRA);
    jest.setSystemTime(T0 + 20_000);
    await expect(seguridad.revokeToken('viejo', EXPIRA)).resolves.toBeUndefined();
    jest.setSystemTime(T0 + 31_000);
    await expect(seguridad.isTokenRevoked('viejo')).resolves.toBe(true);
  });

  it('un token revocado por logout se rechaza siempre, sin ventana de gracia', async () => {
    const iat = Math.floor(T0 / 1000) - 60; // emitido hace un minuto
    jest.setSystemTime(T0 + 1_000);
    await seguridad.revokeAllUserTokens('u-1');
    for (const despues of [0, 5_000, 31_000, 3_600_000]) {
      jest.setSystemTime(T0 + 1_000 + despues);
      await expect(seguridad.isTokenRevokedByGlobalLogout('u-1', iat)).resolves.toBe(true);
    }
  });

  it('el logout también corta un token que se acababa de rotar (dentro de la gracia)', async () => {
    const iat = Math.floor(T0 / 1000) - 60;
    await seguridad.revokeToken('viejo', EXPIRA);
    jest.setSystemTime(T0 + 2_000);
    await seguridad.revokeAllUserTokens('u-1');
    jest.setSystemTime(T0 + 5_000);
    // En la blacklist sigue dentro de la gracia, pero el logout global lo rechaza
    await expect(seguridad.isTokenRevoked('viejo')).resolves.toBe(false);
    await expect(seguridad.isTokenRevokedByGlobalLogout('u-1', iat)).resolves.toBe(true);
  });

  describe('por el camino real de cada petición (JwtStrategy.validate)', () => {
    function estrategia() {
      const s = new JwtStrategy({ get: () => 'secreto' } as any, seguridad, {
        usuario: { findUnique: jest.fn().mockResolvedValue({ rol: 'cliente' }) },
      } as any);
      jest.spyOn(seguridad, 'isUserInactive').mockResolvedValue(false);
      jest.spyOn(seguridad, 'updateLastActivity').mockResolvedValue(undefined);
      return s;
    }
    const peticion = (token: string) => ({ rawToken: token }) as any;
    const payload = { id: 'u-1', email: 'u@example.com', iat: Math.floor(T0 / 1000) - 60 };

    it('acepta el token viejo a los 5 s y lo rechaza a los 31 s', async () => {
      const s = estrategia();
      await seguridad.revokeToken('viejo', EXPIRA);
      jest.setSystemTime(T0 + 5_000);
      await expect(s.validate(peticion('viejo'), payload)).resolves.toMatchObject({ id: 'u-1' });
      jest.setSystemTime(T0 + 31_000);
      await expect(s.validate(peticion('viejo'), payload)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('tras el logout lo rechaza de inmediato', async () => {
      const s = estrategia();
      await seguridad.revokeAllUserTokens('u-1');
      await expect(s.validate(peticion('cualquiera'), payload)).rejects.toThrow('Sesión cerrada');
    });
  });
});
