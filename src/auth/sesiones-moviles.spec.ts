import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { SesionesMovilesService } from './sesiones-moviles.service';
import { DIAS_SESION_MOVIL, hashRefreshToken } from './sesion-movil';
import { JWT_TTL_MOVIL_SEGUNDOS } from './jwt-ttl';

/**
 * Sesiones de la app móvil: token de acceso corto (15 min) + token de renovación rotativo, 30 días sin uso.
 * Prisma va en memoria; el JWT usa un secreto falso.
 */

const DIA_MS = 24 * 60 * 60_000;
const jwt = new JwtService({ secret: 'secreto-falso-solo-para-pruebas' });

type Fila = Record<string, any>;

function crearEscenario(usuarioExtra: Partial<Fila> = {}) {
  const usuario: Fila = {
    id: 'clienta-1',
    email: 'clienta@example.com',
    rol: 'cliente',
    activo: true,
    confirmado: true,
    tokensRevocadosDesde: null,
    ...usuarioExtra,
  };
  const filas: Fila[] = [];
  const coincide = (f: Fila, where: Fila = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('lt' in v) return f[k] != null && f[k] < v.lt;
        if ('lte' in v) return f[k] != null && f[k] <= v.lte;
        if ('not' in v) return f[k] !== v.not;
        if ('in' in v) return v.in.includes(f[k]);
      }
      if (k === 'OR') return (v as Fila[]).some((w) => coincide(f, w));
      return f[k] === v;
    });
  const sesionMovil = {
    create: jest.fn(async ({ data }: any) => {
      if (filas.some((f) => f.tokenHash === data.tokenHash)) throw new Error('tokenHash duplicado');
      const fila = { id: crypto.randomUUID(), creadaEn: new Date(), revocadaEn: null, reemplazadaPorId: null, dispositivo: null, ...data };
      filas.push(fila);
      return { ...fila };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const f = filas.find((x) => (where.tokenHash ? x.tokenHash === where.tokenHash : x.id === where.id));
      return f ? { ...f } : null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      const f = filas.find((x) => coincide(x, where));
      return f ? { ...f } : null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const objetivo = filas.filter((f) => coincide(f, where));
      objetivo.forEach((f) => Object.assign(f, data));
      return { count: objetivo.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const borrar = filas.filter((f) => coincide(f, where));
      borrar.forEach((f) => filas.splice(filas.indexOf(f), 1));
      return { count: borrar.length };
    }),
  };
  const prisma: any = {
    sesionMovil,
    usuario: { findUnique: jest.fn(async ({ where }: any) => (where.id === usuario.id ? { ...usuario } : null)) },
  };
  // Transacción interactiva: si la función lanza, se deshacen las filas que creó ella (no las de otras).
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const creadas: Fila[] = [];
    const tx = {
      ...prisma,
      sesionMovil: {
        ...sesionMovil,
        create: async (args: any) => {
          const fila = await sesionMovil.create(args);
          creadas.push(filas.find((f) => f.id === fila.id)!);
          return fila;
        },
      },
    };
    try {
      return await fn(tx);
    } catch (e) {
      creadas.forEach((f) => filas.splice(filas.indexOf(f), 1));
      throw e;
    }
  });
  const servicio = new SesionesMovilesService(prisma, jwt);
  return { servicio, filas, usuario, prisma };
}

async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (e: any) {
    return { status: e.getStatus?.(), body: e.getResponse?.() };
  }
  throw new Error('se esperaba un error');
}

describe('Sesiones móviles', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('emitir', () => {
    it('crea la sesión con el hash del token de renovación, nunca el token en claro', async () => {
      const { servicio, filas } = crearEscenario();
      const r = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' }, 'Pixel 8 <script>');

      expect(r.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes en base64url
      expect(filas).toHaveLength(1);
      expect(filas[0].tokenHash).toBe(hashRefreshToken(r.refreshToken));
      expect(JSON.stringify(filas)).not.toContain(r.refreshToken);
      expect(filas[0].familiaId).toEqual(expect.any(String));
      expect(filas[0].dispositivo).not.toContain('<');
      const dias = (filas[0].expiraEn.getTime() - Date.now()) / DIA_MS;
      expect(dias).toBeGreaterThan(DIAS_SESION_MOVIL - 0.01);
      expect(dias).toBeLessThanOrEqual(DIAS_SESION_MOVIL);
      expect(new Date(r.refreshExpiraEn).getTime()).toBe(filas[0].expiraEn.getTime());
    });

    it('el token de acceso dura 15 minutos y lleva canal movil y sid', async () => {
      const { servicio, filas } = crearEscenario();
      const r = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const p: any = jwt.decode(r.token);
      expect(JWT_TTL_MOVIL_SEGUNDOS).toBe(15 * 60);
      expect(p.exp - p.iat).toBe(JWT_TTL_MOVIL_SEGUNDOS);
      expect(p).toMatchObject({ id: 'clienta-1', canal: 'movil', sid: filas[0].id });
      expect(p.lastActivity).toBeUndefined();
    });

    it('dispositivo se corta a 80 caracteres', async () => {
      const { servicio, filas } = crearEscenario();
      await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' }, 'x'.repeat(200));
      expect(filas[0].dispositivo).toHaveLength(80);
    });
  });

  describe('renovar', () => {
    it('rota: la fila vieja queda revocada y reemplazada, la nueva es de la misma familia y vence en 30 días', async () => {
      const { servicio, filas } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const r = await servicio.renovar(inicial.refreshToken);

      expect(r.refreshToken).not.toBe(inicial.refreshToken);
      expect(filas).toHaveLength(2);
      const [vieja, nueva] = filas;
      expect(vieja.revocadaEn).toBeInstanceOf(Date);
      expect(vieja.reemplazadaPorId).toBe(nueva.id);
      expect(nueva.familiaId).toBe(vieja.familiaId);
      expect(nueva.tokenHash).toBe(hashRefreshToken(r.refreshToken));
      expect((jwt.decode(r.token) as any)).toMatchObject({ canal: 'movil', sid: nueva.id });
      expect(nueva.expiraEn.getTime()).toBeGreaterThan(Date.now() + (DIAS_SESION_MOVIL - 0.01) * DIA_MS);
      // El nuevo sirve para la siguiente renovación.
      await expect(servicio.renovar(r.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
    });

    it('tope por IP solo para tokens que no existen: la basura no bloquea las renovaciones válidas', async () => {
      const { servicio } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      for (let i = 0; i < 120; i++) {
        expect((await errorDe(servicio.renovar(`basura-${i}`, '10.0.0.1'))).body).toMatchObject({ code: 'SESION_VENCIDA' });
      }
      expect((await errorDe(servicio.renovar('basura-121', '10.0.0.1'))).status).toBe(429);
      // Desde la misma IP (proxy compartido), una clienta con token válido renueva sin problema.
      await expect(servicio.renovar(inicial.refreshToken, '10.0.0.1')).resolves.toMatchObject({ refreshToken: expect.any(String) });
    });

    it('límite por sesión: la undécima renovación de la misma familia dentro de un minuto responde 429', async () => {
      const { servicio } = crearEscenario();
      let { refreshToken } = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      for (let i = 0; i < 10; i++) ({ refreshToken } = await servicio.renovar(refreshToken, '10.0.0.1'));
      expect((await errorDe(servicio.renovar(refreshToken, '10.0.0.1'))).status).toBe(429);
      // Otra clienta desde la misma IP no se ve afectada.
      const otra = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await expect(servicio.renovar(otra.refreshToken, '10.0.0.1')).resolves.toMatchObject({ refreshToken: expect.any(String) });
    });

    it('inexistente: 401 SESION_VENCIDA', async () => {
      const { servicio } = crearEscenario();
      const r = await errorDe(servicio.renovar('no-existe-este-token'));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'SESION_VENCIDA' });
    });

    it('vencida (30 días sin uso): 401 SESION_VENCIDA', async () => {
      const { servicio, filas } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      filas[0].expiraEn = new Date(Date.now() - 1000);
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'SESION_VENCIDA' });
    });

    it('revocada (logout de esa sesión): 401 SESION_REVOCADA', async () => {
      const { servicio } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await servicio.revocarPorToken(inicial.refreshToken, 'clienta-1');
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'SESION_REVOCADA' });
    });

    it('reuso de un token ya rotado (más de 30 s después): revoca toda la familia y 401 SESION_REVOCADA', async () => {
      const { servicio, filas } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const r1 = await servicio.renovar(inicial.refreshToken);
      filas[0].revocadaEn = new Date(Date.now() - 31_000); // la rotación fue hace 31 s

      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'SESION_REVOCADA' });
      expect(filas.every((f) => f.revocadaEn)).toBe(true);
      // El token legítimo más reciente también deja de servir.
      expect((await errorDe(servicio.renovar(r1.refreshToken))).body).toMatchObject({ code: 'SESION_REVOCADA' });
    });

    it('reuso dentro de los 30 s de la rotación (carrera de la misma app): 409 RENOVACION_EN_CURSO sin revocar', async () => {
      const { servicio } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const r1 = await servicio.renovar(inicial.refreshToken);

      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'RENOVACION_EN_CURSO' });
      await expect(servicio.renovar(r1.refreshToken)).resolves.toMatchObject({ refreshToken: expect.any(String) });
    });

    it('dos renovaciones al mismo tiempo con el mismo token: una rota y la otra recibe 409, sin filas de más', async () => {
      const { servicio, filas } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const resultados = await Promise.allSettled([servicio.renovar(inicial.refreshToken), servicio.renovar(inicial.refreshToken)]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rechazo.reason.getResponse()).toMatchObject({ code: 'RENOVACION_EN_CURSO' });
      expect(filas).toHaveLength(2);
    });

    it.each([
      ['desactivada', { activo: false }],
      ['sin confirmar', { confirmado: false }],
      ['que ya no es clienta', { rol: 'estilista' }],
    ])('cuenta %s: 401 SESION_REVOCADA', async (_n, cambio) => {
      const { servicio, usuario } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      Object.assign(usuario, cambio);
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'SESION_REVOCADA' });
    });

    it('sesión anterior a tokensRevocadosDesde (logoutAll, cambio de contraseña): 401 SESION_REVOCADA', async () => {
      const { servicio, usuario } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      usuario.tokensRevocadosDesde = new Date(Date.now() + 1000);
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.body).toMatchObject({ code: 'SESION_REVOCADA' });
    });

    it('una revocación (logoutAll, cambio de contraseña) que llega durante la rotación: 401 y familia cerrada', async () => {
      const { servicio, filas, usuario, prisma } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      // Primera lectura: la cuenta está bien. Segunda (después de rotar): ya se revocó.
      prisma.usuario.findUnique
        .mockImplementationOnce(async () => ({ ...usuario }))
        .mockImplementationOnce(async () => ({ ...usuario, tokensRevocadosDesde: new Date() }));
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(r.body).toMatchObject({ code: 'SESION_REVOCADA' });
      expect(filas.every((f) => f.revocadaEn)).toBe(true);
    });

    it('el token de acceso lleva la familia (fam) para que JwtStrategy pueda cortarlo', async () => {
      const { servicio, filas } = crearEscenario();
      const r = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      expect((jwt.decode(r.token) as any).fam).toBe(filas[0].familiaId);
    });

    it('el token de renovación no aparece en el error', async () => {
      const { servicio } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await servicio.revocarPorToken(inicial.refreshToken, 'clienta-1');
      const r = await errorDe(servicio.renovar(inicial.refreshToken));
      expect(JSON.stringify(r.body)).not.toContain(inicial.refreshToken);
    });
  });

  describe('revocar y limpiar', () => {
    it('revocarPorToken solo revoca sesiones de la misma cuenta', async () => {
      const { servicio, filas } = crearEscenario();
      const inicial = await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await servicio.revocarPorToken(inicial.refreshToken, 'otra-cuenta');
      expect(filas[0].revocadaEn).toBeNull();
      await servicio.revocarPorToken(inicial.refreshToken, 'clienta-1');
      expect(filas[0].revocadaEn).toBeInstanceOf(Date);
    });

    it('revocarTodas marca todas las sesiones activas de la cuenta', async () => {
      const { servicio, filas } = crearEscenario();
      await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      await servicio.revocarTodas('clienta-1');
      expect(filas.every((f) => f.revocadaEn instanceof Date)).toBe(true);
    });

    it('la limpieza diaria borra solo filas vencidas o revocadas hace más de 7 días', async () => {
      const { servicio, filas } = crearEscenario();
      for (let i = 0; i < 4; i++) await servicio.emitir({ id: 'clienta-1', email: 'clienta@example.com' });
      const ahora = new Date();
      filas[0].expiraEn = new Date(ahora.getTime() - 8 * DIA_MS); // vencida hace 8 días: se borra
      filas[1].revocadaEn = new Date(ahora.getTime() - 8 * DIA_MS); // revocada hace 8 días: se borra
      filas[2].revocadaEn = new Date(ahora.getTime() - 2 * DIA_MS); // revocada hace 2 días: se queda
      const conservar = [filas[2].id, filas[3].id];
      const r = await servicio.limpiar(ahora);
      expect(r.borradas).toBe(2);
      expect(filas.map((f) => f.id).sort()).toEqual(conservar.sort());
    });
  });
});
