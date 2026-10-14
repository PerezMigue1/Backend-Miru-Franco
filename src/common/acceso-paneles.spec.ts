import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanActivate, ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { CONTROLLER_WATERMARK, GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { OwnerOrAdminGuard } from './guards/owner-or-admin.guard';
import { puedeVerDatosDeClientes } from './utils/permisos-clientes.util';
import { EcommerceAccessService } from '../ecommerce/common/ecommerce-access.service';
import { PedidoItemsService } from '../ecommerce/pedido-items/pedido-items.service';
import { EnviosService } from '../ecommerce/envios/envios.service';
import { HistorialEstadoPedidoService } from '../ecommerce/historial-estado-pedido/historial-estado-pedido.service';
import { FacturasService } from '../ecommerce/facturas/facturas.service';
import { ValoracionesService } from '../ecommerce/valoraciones/valoraciones.service';
import { PagosService } from '../ecommerce/pagos/pagos.service';
import { QuejasService } from '../quejas/quejas.service';
import { NotificacionesService } from '../ecommerce/notificaciones/notificaciones.service';
import { DireccionesUsuarioService } from '../ecommerce/direcciones-usuario/direcciones-usuario.service';

/**
 * Regresión de accesos de los paneles /admin y /operacion. Los endpoints salen de las peticiones reales
 * observadas en el navegador (src/common/__fixtures__/endpoints-paneles.json, ids cambiados por :id) y se
 * evalúan con las claves de permisos_rol de producción:
 *   a) Guards: cada endpoint se empareja con su handler real (metadata de los controllers) y pasa por
 *      RolesGuard, PermisosGuard y OwnerOrAdminGuard de verdad. Si alguno queda denegado para el rol que lo
 *      usa en su panel, o si el endpoint ya no existe, la prueba falla.
 *   b) Chequeos dentro de los servicios (subrecursos del pedido y datos de clientas), con casos explícitos.
 * Si un endpoint deja de usarse a propósito, se quita del fixture; si un rol pierde una clave en producción,
 * se cambia CLAVES aquí.
 */
const CLAVES: Record<string, string[]> = {
  admin: ['*'],
  estilista: [
    'ventas:escritura', 'caja:escritura', 'caja:lectura', 'citas:escritura', 'seguimientos:lectura',
    'seguimientos:escritura', 'inventario:lectura', 'inventario:escritura', 'servicios:lectura',
    'servicios:escritura', 'clientes:lectura', 'clientes:escritura', 'empleados:lectura', 'solicitudes:gestionar',
    'asistencia:gestionar', 'pedidos:entregar', 'comisiones:configurar', 'devoluciones:gestionar',
  ],
  empleado: [
    'ventas:escritura', 'citas:escritura', 'seguimientos:lectura', 'seguimientos:escritura', 'inventario:lectura',
    'inventario:escritura', 'servicios:lectura', 'clientes:lectura', 'clientes:escritura', 'empleados:lectura',
    'pedidos:entregar', 'comisiones:ver_propias',
  ],
  becario: ['citas:asignadas', 'seguimientos:lectura', 'inventario:lectura', 'servicios:lectura', 'clientes:lectura', 'comisiones:ver_propias'],
  cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'],
};
const ROLES_PANEL = ['admin', 'estilista', 'empleado', 'becario'] as const;

interface EndpointPanel {
  metodo: string;
  ruta: string;
  rol: string;
  panel: string;
  observado: number[];
  /** Solo si el rol ya no tenía este acceso antes (e26619d): 'denegado' y por qué. */
  esperado?: 'denegado';
  motivo?: string;
}
const FIXTURE: EndpointPanel[] = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'endpoints-paneles.json'), 'utf8'));

// Usuarios: `<rol>-yo` para cada rol, y personas ajenas.
const ROL_DE: Record<string, string> = {
  ...Object.fromEntries(Object.keys(CLAVES).map((r) => [`${r}-yo`, r])),
  'otra-clienta': 'cliente',
  'otra-estilista': 'estilista',
};

function prismaFalso() {
  const prisma: any = {
    usuario: { findUnique: jest.fn(async ({ where }: any) => (ROL_DE[where.id] ? { id: where.id, rol: ROL_DE[where.id] } : null)) },
    permisoRol: { findUnique: jest.fn(async ({ where }: any) => (CLAVES[where.rol] ? { claves: CLAVES[where.rol] } : null)) },
    pedido: {
      findUnique: jest.fn(async ({ where }: any) =>
        ({ 9: { id: 9, usuarioId: 'cliente-yo' }, 10: { id: 10, usuarioId: 'otra-clienta' } } as any)[where.id] ?? null,
      ),
    },
    pedidoItem: { findMany: jest.fn(async () => []) },
    envio: { findMany: jest.fn(async () => []) },
    historialEstadoPedido: { findMany: jest.fn(async () => []) },
    factura: { findMany: jest.fn(async () => []) },
    valoracion: { findMany: jest.fn(async () => []) },
    pago: { findMany: jest.fn(async () => []) },
    queja: { findMany: jest.fn(async () => []) },
    notificacion: { findMany: jest.fn(async () => []) },
    direccionUsuario: { findMany: jest.fn(async () => []) },
  };
  return prisma;
}

// ---------- a) Rutas reales de Nest y sus guards ----------
interface RutaNest {
  metodo: string;
  ruta: string;
  clase: any;
  handler: (...args: unknown[]) => unknown;
  nombre: string;
}

function archivosController(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__fixtures__' ? [] : archivosController(p);
    return e.name.endsWith('.controller.ts') ? [p] : [];
  });
}

const comoLista = (v: string | string[] | undefined): string[] => (v === undefined ? [''] : Array.isArray(v) ? v : [v]);
const unir = (...partes: string[]) => '/' + partes.flatMap((p) => p.split('/')).filter(Boolean).join('/');

/**
 * Carga cada *.controller.ts. Los `new RateLimitGuard(...)` de los decoradores arrancan un setInterval al
 * importarse; aquí se crean con unref para que jest pueda terminar al acabar la prueba.
 */
function cargarControllers(): any[] {
  const intervaloReal = global.setInterval;
  const espia = jest.spyOn(global, 'setInterval').mockImplementation(((fn: () => void, ms?: number) =>
    intervaloReal(fn, ms).unref()) as any);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return archivosController(join(__dirname, '..')).map((archivo) => require(archivo));
  } finally {
    espia.mockRestore();
  }
}

function rutasNest(): RutaNest[] {
  const rutas: RutaNest[] = [];
  for (const modulo of cargarControllers()) {
    for (const clase of Object.values(modulo) as any[]) {
      if (typeof clase !== 'function' || !Reflect.getMetadata(CONTROLLER_WATERMARK, clase)) continue;
      for (const prefijo of comoLista(Reflect.getMetadata(PATH_METADATA, clase))) {
        for (const nombre of Object.getOwnPropertyNames(clase.prototype)) {
          if (nombre === 'constructor') continue;
          const handler = clase.prototype[nombre];
          if (typeof handler !== 'function') continue;
          const metodo = Reflect.getMetadata(METHOD_METADATA, handler);
          if (metodo === undefined) continue;
          for (const sub of comoLista(Reflect.getMetadata(PATH_METADATA, handler))) {
            rutas.push({ metodo: RequestMethod[metodo], ruta: unir(prefijo, sub), clase, handler, nombre: `${clase.name}.${nombre}` });
          }
        }
      }
    }
  }
  return rutas;
}

/** El handler que atiende `metodo ruta`: los segmentos fijos ganan a los `:param` (como /citas/dia antes de /citas/:id). */
function emparejar(rutas: RutaNest[], metodo: string, ruta: string): { r: RutaNest; params: Record<string, string> } | null {
  const segs = ruta.split('/').filter(Boolean);
  let mejor: { r: RutaNest; params: Record<string, string>; fijos: number } | null = null;
  for (const r of rutas) {
    if (r.metodo !== metodo && r.metodo !== 'ALL') continue;
    const segsNest = r.ruta.split('/').filter(Boolean);
    if (segsNest.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let fijos = 0;
    let ok = true;
    segsNest.forEach((s, i) => {
      if (s.startsWith(':')) params[s.slice(1)] = segs[i] === ':id' ? 'id-ajeno' : segs[i];
      else if (s === segs[i]) fijos++;
      else ok = false;
    });
    if (ok && (!mejor || fijos > mejor.fijos)) mejor = { r, params, fijos };
  }
  return mejor && { r: mejor.r, params: mejor.params };
}

/** Guards que no deciden por rol ni por claves: sesión (se asume válida), Google OAuth y límite de peticiones. */
const GUARDS_SIN_ROL = ['JwtAuthGuard', 'GoogleAuthGuard', 'SesionOpcionalGuard', 'RateLimitGuard'];

async function evaluarGuards(r: RutaNest, params: Record<string, string>, rol: string): Promise<'permitido' | string> {
  const prisma = prismaFalso();
  const guards = [
    ...(Reflect.getMetadata(GUARDS_METADATA, r.clase) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, r.handler) ?? []),
  ];
  const req = { user: { id: `${rol}-yo`, rol }, params, query: {}, body: {}, headers: {} };
  const ctx = {
    getHandler: () => r.handler,
    getClass: () => r.clase,
    getType: () => 'http',
    getArgs: () => [req, {}],
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;

  for (const g of guards) {
    const nombre: string = typeof g === 'function' ? g.name : g.constructor.name;
    if (GUARDS_SIN_ROL.includes(nombre)) continue;
    let guard: CanActivate;
    if (nombre === 'RolesGuard') guard = new RolesGuard(new Reflector(), prisma);
    else if (nombre === 'PermisosGuard') guard = new PermisosGuard(new Reflector(), prisma);
    else if (nombre === 'OwnerOrAdminGuard') guard = new OwnerOrAdminGuard();
    else throw new Error(`Guard ${nombre} en ${r.nombre} sin evaluar en esta prueba: agrégalo a evaluarGuards`);
    try {
      if (!(await guard.canActivate(ctx))) return `${nombre} devolvió false`;
    } catch (e) {
      if (e instanceof ForbiddenException) return `${nombre}: 403`;
      throw e;
    }
  }
  return 'permitido';
}

describe('Paneles /admin y /operacion: guards reales con las claves de producción', () => {
  const rutas = rutasNest();

  it('se descubren los controllers de Nest y el fixture trae endpoints de cada rol', () => {
    expect(rutas.length).toBeGreaterThan(100);
    for (const rol of ROLES_PANEL) expect(FIXTURE.some((e) => e.rol === rol)).toBe(true);
  });

  it('todo endpoint del fixture existe en algún controller', () => {
    const faltan = FIXTURE.filter((e) => !emparejar(rutas, e.metodo, e.ruta)).map((e) => `${e.metodo} ${e.ruta}`);
    expect([...new Set(faltan)]).toEqual([]);
  });

  it.each(ROLES_PANEL)('%s: ningún endpoint de su panel queda denegado por los guards', async (rol) => {
    const indebidos: string[] = [];
    for (const e of FIXTURE.filter((x) => x.rol === rol)) {
      const par = emparejar(rutas, e.metodo, e.ruta);
      if (!par) continue; // lo reporta la prueba anterior
      const resultado = await evaluarGuards(par.r, par.params, rol);
      const esperado = e.esperado ?? 'permitido';
      const obtenido = resultado === 'permitido' ? 'permitido' : 'denegado';
      if (obtenido !== esperado) indebidos.push(`${e.panel} ${e.metodo} ${e.ruta} (${par.r.nombre}): ${resultado}`);
    }
    expect(indebidos).toEqual([]);
  });

  it('cliente: las rutas de personal del fixture (asistencia, permisos, horas extra) quedan denegadas', async () => {
    const delCliente = FIXTURE.filter((x) => x.rol === 'cliente');
    expect(delCliente.length).toBeGreaterThan(0);
    const indebidos: string[] = [];
    for (const e of delCliente) {
      const par = emparejar(rutas, e.metodo, e.ruta);
      if (!par) continue; // lo reporta la prueba de endpoints existentes
      const resultado = await evaluarGuards(par.r, par.params, 'cliente');
      const obtenido = resultado === 'permitido' ? 'permitido' : 'denegado';
      if (obtenido !== (e.esperado ?? 'permitido')) indebidos.push(`${e.metodo} ${e.ruta} (${par.r.nombre}): ${resultado}`);
    }
    expect(indebidos).toEqual([]);
  });
});

// ---------- b) Chequeos dentro de los servicios ----------
function servicios() {
  const prisma = prismaFalso();
  const access = new EcommerceAccessService(prisma);
  return {
    prisma,
    items: new PedidoItemsService(prisma, access),
    envios: new EnviosService(prisma, access),
    historial: new HistorialEstadoPedidoService(prisma, access),
    facturas: new FacturasService(prisma, access),
    valoraciones: new ValoracionesService(prisma, access),
    pagos: new PagosService(prisma, access),
    quejas: new QuejasService(prisma),
    notificaciones: new NotificacionesService(prisma, access),
    direcciones: new DireccionesUsuarioService(prisma, access),
  };
}

type Servicios = ReturnType<typeof servicios>;
/** Lectura de los subrecursos de un pedido: (servicios, pedidoId, usuario, propios). */
const LECTURAS_DE_PEDIDO: Record<string, (s: Servicios, pedidoId: number, yo: string, propios?: boolean) => Promise<unknown>> = {
  '/pedidos/:id/items': (s, p, yo, propios) => s.items.listarPorPedido(p, yo, propios),
  '/envios/pedido/:id': (s, p, yo, propios) => s.envios.listarPorPedido(p, yo, propios),
  '/historial-estados-pedido/pedido/:id': (s, p, yo, propios) => s.historial.listarPorPedido(p, yo, propios),
  '/facturas/pedido/:id': (s, p, yo, propios) => s.facturas.listarPorPedido(p, yo, propios),
  '/valoraciones/pedido/:id': (s, p, yo, propios) => s.valoraciones.listarPorPedido(p, yo, propios),
  // pagos: con propios=true el 404 lo da el controller (propios-subrecursos.spec); el servicio no recibe propios.
  '/pagos/pedido/:id': (s, p, yo) => s.pagos.listarPorPedido(p, yo),
};
const PEDIDO_AJENO = 10;
const PEDIDO_DE_LA_CLIENTA = 9;

describe('Subrecursos del pedido: la lectura sigue la regla de GET /pedidos/:id', () => {
  const delFixture = FIXTURE.filter((e) => e.metodo === 'GET' && LECTURAS_DE_PEDIDO[e.ruta]);

  it('el fixture trae las lecturas del detalle de pedido de admin y estilista', () => {
    expect(delFixture.filter((e) => e.rol === 'estilista').map((e) => e.ruta).sort()).toEqual(Object.keys(LECTURAS_DE_PEDIDO).sort());
    expect(delFixture.some((e) => e.rol === 'admin')).toBe(true);
  });

  it('las escrituras no se amplían: assertPedido sigue siendo de la dueña o el admin', async () => {
    const access = new EcommerceAccessService(prismaFalso());
    for (const rol of ['estilista', 'empleado', 'becario', 'cliente']) {
      await expect(access.assertPedido(`${rol}-yo`, PEDIDO_AJENO)).rejects.toMatchObject({ status: 403 });
    }
    await expect(access.assertPedido('admin-yo', PEDIDO_AJENO)).resolves.toEqual({ usuarioIdPedido: 'otra-clienta' });
    await expect(access.assertPedido('cliente-yo', PEDIDO_DE_LA_CLIENTA)).resolves.toEqual({ usuarioIdPedido: 'cliente-yo' });
  });

  it.each(delFixture.map((e) => [e.rol, e.ruta] as const))('%s abre GET %s de un pedido ajeno', async (rol, ruta) => {
    await expect(LECTURAS_DE_PEDIDO[ruta](servicios(), PEDIDO_AJENO, `${rol}-yo`)).resolves.toMatchObject({ success: true });
  });

  describe.each(Object.keys(LECTURAS_DE_PEDIDO))('GET %s', (ruta) => {
    const leer = LECTURAS_DE_PEDIDO[ruta];

    it('pedido ajeno: estilista y empleado (pedidos:entregar) y admin lo ven', async () => {
      for (const rol of ['admin', 'estilista', 'empleado']) {
        await expect(leer(servicios(), PEDIDO_AJENO, `${rol}-yo`)).resolves.toMatchObject({ success: true });
      }
    });

    it('pedido ajeno: el becario (sin caja ni pedidos:entregar) y la clienta que no es dueña, 403', async () => {
      for (const rol of ['becario', 'cliente']) {
        await expect(leer(servicios(), PEDIDO_AJENO, `${rol}-yo`)).rejects.toMatchObject({
          status: 403,
          message: 'No tienes permiso para acceder a este recurso',
        });
      }
    });

    it('la dueña ve el suyo', async () => {
      await expect(leer(servicios(), PEDIDO_DE_LA_CLIENTA, 'cliente-yo')).resolves.toMatchObject({ success: true });
    });

    if (ruta !== '/pagos/pedido/:id') {
      it('con propios=true el pedido ajeno es 404 para cualquier rol', async () => {
        for (const rol of [...ROLES_PANEL, 'cliente']) {
          await expect(leer(servicios(), PEDIDO_AJENO, `${rol}-yo`, true)).rejects.toMatchObject({ status: 404 });
        }
        await expect(leer(servicios(), PEDIDO_DE_LA_CLIENTA, 'cliente-yo', true)).resolves.toMatchObject({ success: true });
      });
    }
  });
});

describe('Datos de otras personas con clientes:lectura (quejas, notificaciones, direcciones)', () => {
  it.each(['admin', 'estilista', 'empleado', 'becario'])('%s ve los de una clienta y los de otro miembro del personal', async (rol) => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, rol, 'otra-clienta', `${rol}-yo`)).toBe(true);
    expect(await puedeVerDatosDeClientes(prisma, rol, 'otra-estilista', `${rol}-yo`)).toBe(true);
  });

  it('la clienta (sin clientes:lectura) no ve datos ajenos; los suyos sí', async () => {
    const prisma = prismaFalso();
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'otra-clienta', 'cliente-yo')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'estilista-yo', 'cliente-yo')).toBe(false);
    expect(await puedeVerDatosDeClientes(prisma, 'cliente', 'cliente-yo', 'cliente-yo')).toBe(true);
  });

  it('GET /quejas/cliente/:id del fixture: la estilista abre las de una clienta y las de otra estilista', async () => {
    expect(FIXTURE.some((e) => e.rol === 'estilista' && e.ruta === '/quejas/cliente/:id')).toBe(true);
    const s = servicios();
    await expect(s.quejas.listarPorCliente('otra-clienta', 'estilista-yo')).resolves.toMatchObject({ success: true });
    await expect(s.quejas.listarPorCliente('otra-estilista', 'estilista-yo')).resolves.toMatchObject({ success: true });
    await expect(s.quejas.listarPorCliente('otra-estilista', 'cliente-yo')).rejects.toMatchObject({ status: 403 });
  });

  it('notificaciones y direcciones de otra persona: el personal con clientes:lectura sí; la clienta, 403', async () => {
    const s = servicios();
    for (const rol of ['estilista', 'empleado', 'becario']) {
      await expect(s.notificaciones.listar(`${rol}-yo`, { usuarioId: 'otra-estilista' })).resolves.toMatchObject({ success: true });
      await expect(s.direcciones.listar(`${rol}-yo`, 'otra-estilista')).resolves.toMatchObject({ success: true });
    }
    await expect(s.notificaciones.listar('cliente-yo', { usuarioId: 'otra-clienta' })).rejects.toMatchObject({ status: 403 });
    await expect(s.direcciones.listar('cliente-yo', 'otra-clienta')).rejects.toMatchObject({ status: 403 });
  });
});
