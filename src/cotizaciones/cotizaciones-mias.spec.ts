import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import { CotizacionesController } from './cotizaciones.controller';
import { CotizacionesService } from './cotizaciones.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AUTH_COOKIE_NAME } from '../auth/auth-cookie';
import { SecurityService } from '../common/services/security.service';
import { PrismaService } from '../prisma/prisma.service';
const cookieParser = require('cookie-parser');

const SECRETO = 'secreto-de-prueba';

const USUARIOS: Record<string, { rol: string }> = {
  'u-ana': { rol: 'cliente' },
  'u-beto': { rol: 'cliente' },
  'u-beca': { rol: 'becario' },
};
const PERMISOS: Record<string, string[]> = {
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
  becario: ['citas:asignadas', 'servicios:lectura'],
};

const PAQUETE_XV = { id: 1, tipo_evento: 'XV años', descripcion: 'Peinado y maquillaje', servicios_vinculados: ['s1'], precio_especial: '4500.00' };
const PAQUETE_BODA = { id: 2, tipo_evento: 'Boda', descripcion: 'Novia y damas', servicios_vinculados: ['s2'], precio_especial: '8900.00' };

/** Filas como las guarda la base: con los campos internos que el cliente no debe ver. */
const FILAS = [
  { id: 10, clienteNombre: 'Ana', clienteId: 'u-ana', fechaEvento: new Date('2026-11-20T18:00:00Z'), cantidadPersonas: 4, monto: '4500.00', anticipo: '1000.00', estado: 'pendiente', notas: 'Peinado alto', creadoEn: new Date(), actualizadoEn: new Date(), paqueteId: 1, paquete: PAQUETE_XV, cliente: { id: 'u-ana', nombre: 'Ana', email: 'ana@example.com', telefono: '5550000001' } },
  { id: 11, clienteNombre: 'Ana', clienteId: 'u-ana', fechaEvento: new Date('2027-02-14T17:00:00Z'), cantidadPersonas: null, monto: '8900.00', anticipo: '0.00', estado: 'confirmada', notas: null, creadoEn: new Date(), actualizadoEn: new Date(), paqueteId: 2, paquete: PAQUETE_BODA, cliente: { id: 'u-ana', nombre: 'Ana', email: 'ana@example.com', telefono: '5550000001' } },
  { id: 20, clienteNombre: 'Beto', clienteId: 'u-beto', fechaEvento: new Date('2026-12-01T16:00:00Z'), cantidadPersonas: 2, monto: '4500.00', anticipo: '4500.00', estado: 'confirmada', notas: 'Solo de Beto', creadoEn: new Date(), actualizadoEn: new Date(), paqueteId: 1, paquete: PAQUETE_XV, cliente: { id: 'u-beto', nombre: 'Beto', email: 'beto@example.com', telefono: '5550000002' } },
  { id: 30, clienteNombre: 'Sin cuenta', clienteId: null, fechaEvento: new Date('2026-10-30T16:00:00Z'), cantidadPersonas: 10, monto: '9000.00', anticipo: '0.00', estado: 'pendiente', notas: null, creadoEn: new Date(), actualizadoEn: new Date(), paqueteId: 2, paquete: PAQUETE_BODA, cliente: null },
];

/** Aplica un `select` de Prisma (anidado) a una fila. */
function proyectar(fila: any, select: Record<string, any> | undefined): any {
  if (!select || fila == null) return fila;
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, v]) => v)
      .map(([k, v]) => [k, typeof v === 'object' ? proyectar(fila[k], v.select) : fila[k]]),
  );
}

/** Prisma en memoria: `where` por igualdad (undefined = sin filtro, como Prisma), `select` y `orderBy`. */
function prismaEnMemoria() {
  return {
    usuario: {
      findUnique: jest.fn(async ({ where }: any) => USUARIOS[where.id] ?? null),
    },
    permisoRol: {
      findUnique: jest.fn(async ({ where }: any) => (PERMISOS[where.rol] ? { claves: PERMISOS[where.rol] } : null)),
    },
    cotizacion: {
      findMany: jest.fn(async ({ where = {}, select, orderBy }: any) => {
        let filas = FILAS.filter((f: any) => Object.entries(where).every(([k, v]) => v === undefined || f[k] === v));
        if (orderBy?.fechaEvento) {
          const signo = orderBy.fechaEvento === 'desc' ? -1 : 1;
          filas = [...filas].sort((a, b) => signo * (a.fechaEvento.getTime() - b.fechaEvento.getTime()));
        }
        return filas.map((f) => proyectar(structuredClone(f), select));
      }),
      findUnique: jest.fn(),
    },
  };
}

describe('GET /api/cotizaciones/mias', () => {
  let app: INestApplication;
  let base: string;
  let prisma: ReturnType<typeof prismaEnMemoria>;

  const sesion = (id: string) => `${AUTH_COOKIE_NAME}=${jwt.sign({ id, email: `${id}@example.com` }, SECRETO, { expiresIn: '5m' })}`;
  const pedir = (ruta: string, cookie?: string) => fetch(`${base}${ruta}`, { headers: cookie ? { cookie } : {} });

  beforeAll(async () => {
    prisma = prismaEnMemoria();
    const modulo = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [CotizacionesController],
      providers: [
        CotizacionesService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SecurityService,
          useValue: {
            isTokenRevoked: async () => false,
            isTokenRevokedByGlobalLogout: async () => false,
            isUserInactive: async () => false,
            updateLastActivity: async () => undefined,
          },
        },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO : undefined) } },
      ],
    }).compile();

    app = modulo.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('devuelve solo las cotizaciones del usuario de la sesión, más recientes primero', async () => {
    const res = await pedir('/api/cotizaciones/mias', sesion('u-ana'));
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(cuerpo.data.map((c: any) => c.id)).toEqual([11, 10]);
    expect(cuerpo.count).toBe(2);
    expect(prisma.cotizacion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clienteId: 'u-ana' } }));
    // /mias no la captura la ruta /:id
    expect(prisma.cotizacion.findUnique).not.toHaveBeenCalled();
  });

  it('un cliente nunca ve las cotizaciones de otro, aunque mande clienteId por query', async () => {
    const beto = await (await pedir('/api/cotizaciones/mias', sesion('u-beto'))).json();
    expect(beto.data.map((c: any) => c.id)).toEqual([20]);

    const ana = await (await pedir('/api/cotizaciones/mias?clienteId=u-beto', sesion('u-ana'))).json();
    expect(ana.data.map((c: any) => c.id)).toEqual([11, 10]);
    expect(ana.data.some((c: any) => c.notas === 'Solo de Beto')).toBe(false);
  });

  it('responde 401 sin sesión o con un token inválido', async () => {
    expect((await pedir('/api/cotizaciones/mias')).status).toBe(401);
    expect((await pedir('/api/cotizaciones/mias', `${AUTH_COOKIE_NAME}=no-es-un-jwt`)).status).toBe(401);
    expect(prisma.cotizacion.findMany).not.toHaveBeenCalled();
  });

  it('un rol sin el permiso recibe 403', async () => {
    const res = await pedir('/api/cotizaciones/mias', sesion('u-beca'));
    expect(res.status).toBe(403);
    expect(prisma.cotizacion.findMany).not.toHaveBeenCalled();
  });

  it('la respuesta no incluye campos fuera de la lista', async () => {
    const { data } = await (await pedir('/api/cotizaciones/mias', sesion('u-ana'))).json();

    for (const c of data) {
      expect(Object.keys(c).sort()).toEqual(
        ['anticipo', 'cantidadPersonas', 'estado', 'fechaEvento', 'id', 'monto', 'notas', 'paquete'].sort(),
      );
      expect(Object.keys(c.paquete).sort()).toEqual(['precio_especial', 'tipo_evento']);
    }
    expect(JSON.stringify(data)).not.toMatch(/clienteId|clienteNombre|ana@example\.com|descripcion|servicios_vinculados/);
  });

  it('el service no consulta sin id de usuario (sin él, Prisma devolvería todas)', async () => {
    const servicio = new CotizacionesService(prisma as any);
    await expect(servicio.listarMias(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.cotizacion.findMany).not.toHaveBeenCalled();
  });
});
