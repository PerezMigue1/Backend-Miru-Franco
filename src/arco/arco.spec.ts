import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermisosGuard } from '../common/guards/permisos.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { EmailModule } from '../email/email.module';
import { PrismaService } from '../prisma/prisma.service';
import { ArcoService } from './arco.service';

// Cada RateLimitGuard arranca un setInterval al importarse el controlador: unref para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ArcoController } = require('./arco.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ArcoModule } = require('./arco.module');

/**
 * Derechos ARCO: folio (lo genera la base), plazos en días hábiles (20 para responder y 15 para hacerlo efectivo),
 * mis datos, oposición a promociones, bandeja del admin y cancelación por anonimización. Prisma y correo simulados.
 *
 * Las transacciones reciben un cliente `tx` DISTINTO del prisma raíz: en el raíz, las escrituras que van dentro de una
 * transacción lanzan "fuera de la transacción", así que usar this.prisma en vez de tx hace fallar la prueba.
 */
const CONTEXTO = { ip: '201.140.10.5', userAgent: 'Navegador de prueba' };
const CONTEXTO_ADMIN = { ip: '10.0.0.7', userAgent: 'Navegador del salon' };
// Miércoles 14 de octubre de 2026, 12:00 en México.
const AHORA = new Date('2026-10-14T18:00:00.000Z');

/** Escrituras que el servicio hace dentro de una transacción (van por tx). */
const ESCRITURAS_TX: Record<string, string[]> = {
  usuario: ['update'],
  consentimiento: ['create'],
  galeriaFoto: ['updateMany'],
  solicitudArco: ['create', 'update', 'updateMany'],
  metodoPagoUsuario: ['deleteMany'],
  carritoItem: ['deleteMany'],
  direccionUsuario: ['updateMany'],
  dispositivoPush: ['deleteMany'],
  solicitudCambioCorreo: ['deleteMany'],
  notificacion: ['deleteMany'],
  observacionCliente: ['deleteMany'],
  cita: ['updateMany'],
  pedido: ['updateMany'],
  cotizacion: ['updateMany'],
  seguimientoPostServicio: ['updateMany'],
  ventaLocal: ['updateMany'],
  sesionMovil: ['deleteMany'],
  preferenciaNotificacion: ['deleteMany'],
};

const fuera = (que: string) =>
  jest.fn(() => {
    throw new Error(`${que} fuera de la transacción`);
  });

/** Prisma raíz (lecturas y la alta de crearSolicitud) y `prisma.tx`, el cliente de la transacción. */
function prismaBase() {
  const tx: any = {};
  for (const [modelo, ops] of Object.entries(ESCRITURAS_TX)) {
    tx[modelo] = {};
    for (const op of ops) tx[modelo][op] = jest.fn().mockResolvedValue({ count: 0 });
  }
  tx.usuario.update = jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data }));
  tx.consentimiento.create = jest.fn(async ({ data }: any) => ({ id: BigInt(5), ...data }));
  tx.solicitudArco.create = jest.fn(async ({ data }: any) => ({ id: 1, folio: 'ARCO-2026-000001', estado: data.estado ?? 'recibida', ...data }));
  tx.solicitudArco.updateMany = jest.fn().mockResolvedValue({ count: 1 });

  const lista = () => jest.fn().mockResolvedValue([]);
  const cero = () => jest.fn().mockResolvedValue(0);
  const prisma: any = {
    solicitudArco: {
      // crearSolicitud escribe sin transacción
      create: jest.fn(async ({ data }: any) => ({ id: 1, folio: 'ARCO-2026-000001', estado: data.estado ?? 'recibida', ...data })),
      findMany: lista(),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      count: cero(),
    },
    usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-1', nombre: 'Ana', email: 'ana@example.com', rol: 'cliente' }) },
    consentimiento: { findMany: lista() },
    direccionUsuario: { findMany: lista() },
    pedido: { findMany: lista(), count: cero() },
    cita: { findMany: lista(), count: cero() },
    metodoPagoUsuario: { findMany: lista() },
    ventaLocal: { findMany: lista() },
    factura: { findMany: lista() },
    queja: { findMany: lista() },
    valoracion: { findMany: lista() },
    cotizacion: { findMany: lista() },
    observacionCliente: { findMany: lista() },
    seguimientoPostServicio: { findMany: lista() },
    devolucion: { findMany: lista(), count: cero() },
    pago: { findMany: lista() },
    notificacion: { findMany: lista() },
    preferenciaNotificacion: { findMany: lista() },
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg))),
    tx,
  };
  for (const [modelo, ops] of Object.entries(ESCRITURAS_TX)) {
    prisma[modelo] = prisma[modelo] ?? {};
    for (const op of ops) {
      if (modelo === 'solicitudArco' && op === 'create') continue;
      prisma[modelo][op] = fuera(`${modelo}.${op}`);
    }
  }
  return prisma;
}

function correoFalso(): any {
  return {
    sendRespuestaArcoEmail: jest.fn().mockResolvedValue(undefined),
    sendCancelacionCuentaArcoEmail: jest.fn().mockResolvedValue(undefined),
  };
}

const servicio = (prisma: any, correo: any = correoFalso()) => new ArcoService(prisma, correo);

/** El error con el que rechaza la promesa (para revisar tipo y cuerpo). */
async function errorDe(promesa: Promise<unknown>): Promise<any> {
  try {
    await promesa;
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba un error');
}

/** Lo que escribe el Logger durante la prueba (para revisar que no lleve datos personales). */
function capturarLogs(): string[] {
  const salidas: string[] = [];
  const capturar = (...a: unknown[]) => {
    salidas.push(a.map(String).join(' '));
  };
  for (const m of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, m).mockImplementation(capturar as any);
  return salidas;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ArcoService.crearSolicitud', () => {
  it('crea la solicitud sin mandar folio (lo genera la base) y vence_respuesta = 20 días hábiles', async () => {
    const prisma = prismaBase();
    const r = await servicio(prisma).crearSolicitud('u-1', { tipo: 'acceso', descripcion: '  Quiero mis datos\u0000 ' }, AHORA);
    const { data } = prisma.solicitudArco.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('folio');
    expect(data).toMatchObject({ usuarioId: 'u-1', tipo: 'acceso', descripcion: 'Quiero mis datos', creadaEn: AHORA });
    // 20 días hábiles desde el 14 de octubre (sin domingos; los sábados cuentan): viernes 6 de noviembre, 23:59:59.999 en México
    expect(data.venceRespuesta).toEqual(new Date('2026-11-07T05:59:59.999Z'));
    expect(r).toMatchObject({ success: true, data: { folio: 'ARCO-2026-000001' } });
  });

  it('la solicitud de la clienta no puede fijar estado, folio ni otra persona', async () => {
    const prisma = prismaBase();
    await servicio(prisma).crearSolicitud('u-1', { tipo: 'cancelacion' } as any, AHORA);
    const { data } = prisma.solicitudArco.create.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['creadaEn', 'descripcion', 'tipo', 'usuarioId', 'venceRespuesta']);
    expect(data.descripcion).toBeNull();
  });

  it('una segunda cancelación abierta de la misma persona: 409 con el folio de la abierta, y no se crea', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findFirst.mockResolvedValue({ folio: 'ARCO-2026-000003' });
    const error = await errorDe(servicio(prisma).crearSolicitud('u-1', { tipo: 'cancelacion' }, AHORA));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({
      message: 'Ya tienes una solicitud de cancelación abierta con folio ARCO-2026-000003.',
      code: 'CANCELACION_ABIERTA',
    });
    expect(prisma.solicitudArco.findFirst.mock.calls[0][0]).toMatchObject({
      where: { usuarioId: 'u-1', tipo: 'cancelacion', estado: { notIn: ['atendida', 'rechazada'] } },
    });
    expect(prisma.solicitudArco.create).not.toHaveBeenCalled();
  });

  it('sin cancelación abierta sí se crea; los demás tipos no se limitan', async () => {
    const prisma = prismaBase();
    await servicio(prisma).crearSolicitud('u-1', { tipo: 'cancelacion' }, AHORA);
    expect(prisma.solicitudArco.create).toHaveBeenCalledTimes(1);

    const otra = prismaBase();
    otra.solicitudArco.findFirst.mockResolvedValue({ folio: 'ARCO-2026-000003' });
    await servicio(otra).crearSolicitud('u-1', { tipo: 'acceso' }, AHORA);
    expect(otra.solicitudArco.create).toHaveBeenCalledTimes(1);
  });
});

describe('ArcoService: solicitudes propias y mis datos', () => {
  it('mias filtra por la usuaria de la sesión', async () => {
    const prisma = prismaBase();
    await servicio(prisma).mias('u-1');
    expect(prisma.solicitudArco.findMany.mock.calls[0][0]).toMatchObject({ where: { usuarioId: 'u-1' }, orderBy: { creadaEn: 'desc' } });
    expect(prisma.solicitudArco.findMany.mock.calls[0][0].select).not.toHaveProperty('atendidaPorId');
  });

  it('mis-datos devuelve perfil (con salud), direcciones, pedidos, citas, consentimientos y solicitudes; nada secreto', async () => {
    const prisma = prismaBase();
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-1', nombre: 'Ana', alergias: 'Látex' });
    prisma.direccionUsuario.findMany.mockResolvedValue([{ id: 'd-1' }]);
    prisma.pedido.findMany.mockResolvedValue([{ id: 9, items: [] }]);
    prisma.cita.findMany.mockResolvedValue([{ id: 3 }]);
    prisma.consentimiento.findMany.mockResolvedValue([{ id: BigInt(77), tipo: 'terminos' }]);
    prisma.solicitudArco.findMany.mockResolvedValue([{ id: 1, folio: 'ARCO-2026-000001' }]);

    const r = await servicio(prisma).misDatos('u-1');

    const select = prisma.usuario.findUnique.mock.calls[0][0].select;
    expect(prisma.usuario.findUnique.mock.calls[0][0].where).toEqual({ id: 'u-1' });
    for (const campo of ['nombre', 'email', 'telefono', 'fechaNacimiento', 'alergias', 'tipoCabello', 'tratamientos', 'recibePromociones']) {
      expect(select[campo]).toBe(true);
    }
    for (const secreto of ['password', 'respuestaSeguridad', 'codigoOTP', 'resetPasswordToken', 'tokensRevocadosDesde']) {
      expect(select).not.toHaveProperty(secreto);
    }
    expect(prisma.direccionUsuario.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.pedido.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.cita.findMany.mock.calls[0][0].where).toEqual({ clienteId: 'u-1' });
    expect(prisma.consentimiento.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.solicitudArco.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      perfil: { id: 'u-1', alergias: 'Látex' },
      direcciones: [{ id: 'd-1' }],
      pedidos: [{ id: 9 }],
      citas: [{ id: 3 }],
      consentimientos: [{ id: '77', tipo: 'terminos' }],
      solicitudesArco: [{ folio: 'ARCO-2026-000001' }],
    });
    expect(typeof r.data.generadoEn).toBe('string');
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  it('mis-datos también trae sus ventas en el salón, las facturas de sus pedidos, quejas, valoraciones, tarjetas guardadas y cotizaciones', async () => {
    const prisma = prismaBase();
    prisma.ventaLocal.findMany.mockResolvedValue([{ id: 11, folio: 'V-0001' }]);
    prisma.factura.findMany.mockResolvedValue([{ id: 21, rfc: 'XAXX010101000' }]);
    prisma.queja.findMany.mockResolvedValue([{ id: 31, asunto: 'Tardaron' }]);
    prisma.valoracion.findMany.mockResolvedValue([{ id: 41, puntuacion: 5 }]);
    prisma.metodoPagoUsuario.findMany.mockResolvedValue([{ id: 'm-1', ultimos4: '4242' }]);
    prisma.cotizacion.findMany.mockResolvedValue([{ id: 51, clienteNombre: 'Ana' }]);

    const r = await servicio(prisma).misDatos('u-1');

    expect(prisma.ventaLocal.findMany.mock.calls[0][0].where).toEqual({ clienteId: 'u-1' });
    expect(prisma.factura.findMany.mock.calls[0][0].where).toEqual({ pedido: { usuarioId: 'u-1' } });
    expect(prisma.queja.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.valoracion.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.metodoPagoUsuario.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.cotizacion.findMany.mock.calls[0][0].where).toEqual({ clienteId: 'u-1' });
    // Tarjetas: lo que la titular reconoce (marca, últimos 4), nunca el identificador de la pasarela con el que se cobra
    const tarjetas = prisma.metodoPagoUsuario.findMany.mock.calls[0][0].select;
    expect(tarjetas).toMatchObject({ marca: true, ultimos4: true });
    expect(tarjetas).not.toHaveProperty('idExterno');
    // Ventas con sus artículos (servicio o producto, cantidad y precio); sin datos del personal (cajero, quién emitió la factura)
    expect(prisma.ventaLocal.findMany.mock.calls[0][0].select.items.select).toMatchObject({
      cantidad: true,
      precioUnitario: true,
      subtotal: true,
      servicio: expect.any(Object),
      presentacion: expect.any(Object),
    });
    expect(JSON.stringify(prisma.ventaLocal.findMany.mock.calls[0][0])).not.toMatch(/cajero/);
    expect(prisma.factura.findMany.mock.calls[0][0].select).not.toHaveProperty('creadoPorId');
    expect(prisma.factura.findMany.mock.calls[0][0].select).not.toHaveProperty('creadoPor');
    expect(r.data).toMatchObject({
      ventasSalon: [{ id: 11 }],
      facturas: [{ id: 21 }],
      quejas: [{ id: 31 }],
      valoraciones: [{ id: 41 }],
      metodosPago: [{ id: 'm-1' }],
      cotizaciones: [{ id: 51 }],
    });
  });

  it('mis-datos trae las observaciones que el personal registró sobre ella (texto y fecha, sin quién del personal)', async () => {
    const prisma = prismaBase();
    prisma.observacionCliente.findMany.mockResolvedValue([{ id: 61, texto: 'Prefiere tonos fríos', creadoEn: AHORA }]);

    const r = await servicio(prisma).misDatos('u-1');

    const args = prisma.observacionCliente.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ clienteId: 'u-1' });
    expect(args.select).toEqual({ id: true, texto: true, creadoEn: true });
    expect(r.data).toMatchObject({ observaciones: [{ id: 61, texto: 'Prefiere tonos fríos' }] });
  });

  it('tarjetas guardadas: solo marca, últimos 4 dígitos y vencimiento', async () => {
    const prisma = prismaBase();
    await servicio(prisma).misDatos('u-1');
    expect(prisma.metodoPagoUsuario.findMany.mock.calls[0][0].select).toEqual({ marca: true, ultimos4: true, expMes: true, expAnio: true });
  });

  /** Simula el `select` de Prisma sobre una fila completa: solo salen los campos pedidos. */
  function aplicarSelect(fila: Record<string, unknown>, select: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, v]) => v === true)
        .map(([k]) => [k, fila[k]]),
    );
  }

  it('mis-datos trae seguimientos, devoluciones, pagos (de pedidos y anticipos de citas), notificaciones y preferencias, sin secretos', async () => {
    const prisma = prismaBase();
    // Filas completas como en la base, con columnas que no deben salir; el mock aplica el select como Prisma
    const filas: Record<string, Record<string, unknown>> = {
      seguimientoPostServicio: {
        id: 1, notas: 'Llamó contenta', fechaContacto: AHORA, satisfaccion: 5, requiereAccion: false, citaId: 3,
        usuarioId: 'u-1', creadoEn: AHORA, actualizadoEn: AHORA,
      },
      devolucion: {
        id: 2, motivo: 'Llegó roto', estado: 'pendiente', monto: '100.00', tipo: 'reembolso', causa: 'defecto',
        metodoReembolso: null, origen: 'solicitud', notaResolucion: null, resueltoEn: null, resueltoPorId: 'admin-SECRETO',
        pedidoId: 9, pedidoItemId: 4, pagoId: 8, creadoEn: AHORA, actualizadoEn: AHORA,
      },
      pago: {
        id: 8, pedidoId: 9, citaId: null, intentoNumero: 1, monto: '300.00', moneda: 'MXN', metodo: 'mercado_pago',
        proveedor: 'mercadopago', estado: 'aprobado', referenciaExterna: 'MP-SECRETO-123', errorMensaje: 'detalle interno SECRETO',
        payload: { token: 'tok_SECRETO' }, pagadoEn: AHORA, retenidoEn: null, reembolsadoEn: null, cobradoPorId: 'cajera-SECRETO',
        corteId: 2, creadoEn: AHORA, actualizadoEn: AHORA,
      },
      notificacion: {
        id: 'n-1', tipo: 'cita', titulo: 'Tu cita', mensaje: 'Mañana a las 10', leida: false,
        metadata: { enlace: 'https://x.example/reset?token=SECRETO' }, creadoEn: AHORA, prioridad: 'alta', entidadTipo: 'cita',
        entidadId: '3', urlAccion: '/citas/3', programadaPara: null, leidaEn: null, usuarioId: 'u-1',
      },
      preferenciaNotificacion: { usuarioId: 'u-1', tipo: 'cita', canal: 'email', activo: true, creadoEn: AHORA },
    };
    for (const [modelo, fila] of Object.entries(filas)) {
      prisma[modelo].findMany = jest.fn(async (args: any) => {
        if (!args?.select) throw new Error(`${modelo} sin select explícito`);
        return [aplicarSelect(fila, args.select)];
      });
    }

    const r = await servicio(prisma).misDatos('u-1');

    expect(prisma.seguimientoPostServicio.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.devolucion.findMany.mock.calls[0][0].where).toEqual({ pedido: { usuarioId: 'u-1' } });
    expect(prisma.pago.findMany.mock.calls[0][0].where).toEqual({ OR: [{ pedido: { usuarioId: 'u-1' } }, { cita: { clienteId: 'u-1' } }] });
    expect(prisma.notificacion.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(prisma.preferenciaNotificacion.findMany.mock.calls[0][0].where).toEqual({ usuarioId: 'u-1' });
    expect(r.data).toMatchObject({
      seguimientos: [{ id: 1, notas: 'Llamó contenta', satisfaccion: 5, citaId: 3 }],
      devoluciones: [{ id: 2, motivo: 'Llegó roto', estado: 'pendiente', monto: '100.00', pedidoId: 9 }],
      pagos: [{ id: 8, monto: '300.00', estado: 'aprobado', metodo: 'mercado_pago', pedidoId: 9 }],
      notificaciones: [{ id: 'n-1', titulo: 'Tu cita', mensaje: 'Mañana a las 10', leida: false }],
      preferenciasNotificacion: [{ tipo: 'cita', canal: 'email', activo: true }],
    });
    const texto = JSON.stringify(r);
    for (const secreto of ['SECRETO', 'payload', 'metadata', 'referenciaExterna', 'errorMensaje', 'cobradoPor', 'resueltoPor', 'corteId']) {
      expect(texto).not.toContain(secreto);
    }
  });

  it('ninguna consulta de mis-datos pide contraseñas, tokens, códigos ni respuestas de seguridad', async () => {
    const prisma = prismaBase();
    await servicio(prisma).misDatos('u-1');
    const consultas = Object.entries(prisma)
      .filter(([, modelo]: [string, any]) => modelo?.findMany || modelo?.findUnique)
      .flatMap(([, modelo]: [string, any]) => [...(modelo.findMany?.mock.calls ?? []), ...(modelo.findUnique?.mock.calls ?? [])]);
    expect(consultas.length).toBeGreaterThanOrEqual(18);
    const texto = JSON.stringify(consultas);
    for (const secreto of [
      'password', 'respuestaSeguridad', 'codigoOTP', 'otpExpira', 'resetPasswordToken', 'tokensRevocadosDesde', 'idExterno', 'codigoHash',
      'tokenHash', 'payload', 'metadata', 'referenciaExterna',
    ]) {
      expect(texto).not.toContain(secreto);
    }
  });

  /**
   * Una relación pedida como `include: { usuario: true }` trae la fila completa de esa persona (password,
   * respuestaSeguridad, tokens) sin escribir ninguno de esos nombres. Se recorren los argumentos de cada consulta:
   * ninguna relación en `true`, y las relaciones a personas solo con id y nombre.
   */
  const PERSONAS = ['usuario', 'cliente', 'especialista', 'autor', 'cajero', 'creadoPor', 'resueltoPor', 'atendidaPor', 'cobradoPor'];
  function problemas(nodo: unknown, ruta: string, dentroDeRelacion: boolean, salida: string[]) {
    if (!nodo || typeof nodo !== 'object') return;
    for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
      const aqui = `${ruta}.${clave}`;
      if (clave === 'include' || clave === 'select') {
        for (const [campo, v] of Object.entries((valor ?? {}) as Record<string, unknown>)) {
          if (PERSONAS.includes(campo)) {
            const sel = (v as any)?.select;
            if (!sel) salida.push(`${aqui}.${campo}: relación a persona sin select`);
            else for (const k of Object.keys(sel)) if (!['id', 'nombre'].includes(k)) salida.push(`${aqui}.${campo}.select.${k}`);
          } else if (clave === 'include' && v === true) {
            salida.push(`${aqui}.${campo}: relación completa (true)`);
          }
          problemas(v, `${aqui}.${campo}`, true, salida);
        }
      } else if (!dentroDeRelacion) {
        problemas(valor, aqui, false, salida);
      }
    }
  }

  it('mis-datos: ninguna relación completa y las personas relacionadas solo con id y nombre (también en las secciones nuevas)', async () => {
    const prisma = prismaBase();
    await servicio(prisma).misDatos('u-1');
    const salida: string[] = [];
    let revisadas = 0;
    for (const [modelo, ops] of Object.entries(prisma) as [string, any][]) {
      for (const op of ['findMany', 'findUnique']) {
        for (const [args] of ops?.[op]?.mock?.calls ?? []) {
          revisadas++;
          problemas(args, `${modelo}.${op}`, false, salida);
        }
      }
    }
    expect(revisadas).toBeGreaterThanOrEqual(18);
    expect(salida).toEqual([]);
  });

  it('el detector encuentra una relación completa o una persona con más que id y nombre', () => {
    const salida: string[] = [];
    problemas({ where: {}, include: { usuario: true } }, 'queja.findMany', false, salida);
    problemas({ include: { especialista: { select: { id: true, nombre: true, email: true } } } }, 'cita.findMany', false, salida);
    problemas({ include: { paquete: true } }, 'cotizacion.findMany', false, salida);
    expect(salida).toEqual([
      'queja.findMany.include.usuario: relación a persona sin select',
      'cita.findMany.include.especialista.select.email',
      'cotizacion.findMany.include.paquete: relación completa (true)',
    ]);
  });
});

describe('ArcoService.oposicion (promociones)', () => {
  it('aplica de inmediato en una transacción por tx: recibePromociones=false, consentimiento revocado (ruta /perfil) y solicitud atendida', async () => {
    const prisma = prismaBase();
    // La solicitud de oposición se crea dentro de la transacción: en el prisma raíz, lanza
    prisma.solicitudArco.create = fuera('solicitudArco.create');
    const { tx } = prisma;
    const r = await servicio(prisma).oposicion('u-1', { finalidad: 'promociones' }, CONTEXTO, AHORA);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: false } });
    expect(tx.consentimiento.create).toHaveBeenCalledTimes(1);
    expect(tx.consentimiento.create.mock.calls[0][0].data).toMatchObject({
      usuarioId: 'u-1',
      tipo: 'promociones',
      accion: 'revocado',
      formulario: 'arco_oposicion',
      rutaOrigen: '/perfil',
      ip: CONTEXTO.ip,
      userAgent: CONTEXTO.userAgent,
      metodo: 'casilla_marcada',
    });
    // La registra la propia titular: sin personal que la capture
    expect(tx.consentimiento.create.mock.calls[0][0].data.registradoPorId ?? null).toBeNull();
    expect(tx.solicitudArco.create).toHaveBeenCalledTimes(1);
    const solicitud = tx.solicitudArco.create.mock.calls[0][0].data;
    expect(solicitud).toMatchObject({ usuarioId: 'u-1', tipo: 'oposicion', estado: 'atendida', creadaEn: AHORA, respondidaEn: AHORA, atendidaEn: AHORA });
    expect(solicitud.venceRespuesta).toEqual(new Date('2026-11-07T05:59:59.999Z'));
    expect(solicitud).not.toHaveProperty('folio');
    expect(r).toMatchObject({ success: true, data: { tipo: 'oposicion', estado: 'atendida' } });
  });
});

describe('ArcoService: bandeja del admin', () => {
  const solicitud = (cambios: Record<string, unknown> = {}) => ({
    id: 4,
    folio: 'ARCO-2026-000004',
    usuarioId: 'u-1',
    tipo: 'acceso',
    estado: 'recibida',
    respuesta: null,
    respondidaEn: null,
    venceEfectividad: null,
    ...cambios,
  });

  it('lista con datos de la persona, filtra por estado y pagina', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findMany.mockResolvedValue([
      { id: 1, estado: 'recibida', venceRespuesta: new Date('2026-10-01T00:00:00.000Z'), venceEfectividad: null },
    ]);
    prisma.solicitudArco.count.mockResolvedValue(1);
    const r = await servicio(prisma).listarAdmin({ estado: 'recibida', page: '1', limit: '10' }, AHORA);
    const args = prisma.solicitudArco.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ estado: 'recibida' });
    expect(args.include.usuario.select).toEqual({ id: true, nombre: true, email: true, telefono: true });
    expect(args).toMatchObject({ skip: 0, take: 10 });
    expect(r).toMatchObject({ success: true, total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(r.data[0].vencida).toBe(true);
  });

  it('vencidas=true: sin responder con el plazo de respuesta pasado, o respondidas con el de efectividad pasado', async () => {
    const prisma = prismaBase();
    await servicio(prisma).listarAdmin({ vencidas: 'true' }, AHORA);
    expect(prisma.solicitudArco.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { estado: { in: ['recibida', 'en_proceso'] }, venceRespuesta: { lt: AHORA } },
        { estado: 'respondida', venceEfectividad: { lt: AHORA } },
      ],
    });
  });

  it('vencidas=false: solo las que están en plazo (la misma regla que el campo vencida), incluidas las cerradas', async () => {
    const prisma = prismaBase();
    await servicio(prisma).listarAdmin({ vencidas: 'false' }, AHORA);
    const where = prisma.solicitudArco.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { estado: { in: ['recibida', 'en_proceso'] }, venceRespuesta: { gte: AHORA } },
        { estado: 'respondida', OR: [{ venceEfectividad: null }, { venceEfectividad: { gte: AHORA } }] },
        { estado: { in: ['atendida', 'rechazada'] } },
      ],
    });
    // El total cuenta lo mismo que la página
    expect(prisma.solicitudArco.count.mock.calls[0][0].where).toEqual(where);
  });

  it('pasar a respondida (atómico, con el estado esperado) guarda respondida_en y vence_efectividad = 15 días hábiles (salta el festivo del 16 de noviembre)', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'en_proceso' }));
    const respondida = new Date('2026-11-05T18:00:00.000Z');
    const r = await servicio(prisma).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Te enviamos tus datos.' }, 'admin-1', CONTEXTO_ADMIN, respondida);
    expect(prisma.tx.solicitudArco.updateMany).toHaveBeenCalledWith({
      where: { id: 4, estado: 'en_proceso' },
      data: { estado: 'respondida', respuesta: 'Te enviamos tus datos.', respondidaEn: respondida, venceEfectividad: new Date('2026-11-25T05:59:59.999Z') },
    });
    expect(r).toMatchObject({ success: true, data: { id: 4, folio: 'ARCO-2026-000004', estado: 'respondida', respuesta: 'Te enviamos tus datos.' } });
  });

  it('respondida o rechazada sin respuesta: 400 y no se escribe nada', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud());
    await expect(servicio(prisma).actualizarAdmin(4, { estado: 'respondida' }, 'admin-1', CONTEXTO_ADMIN, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio(prisma).actualizarAdmin(4, { estado: 'rechazada', respuesta: '  ' }, 'admin-1', CONTEXTO_ADMIN, AHORA)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tx.solicitudArco.updateMany).not.toHaveBeenCalled();
  });

  it('atendida guarda quién y cuándo y usa la respuesta ya dada; una cancelación solo se atiende ejecutándola', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'rectificacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Corregimos tu teléfono.' }));
    await servicio(prisma).actualizarAdmin(4, { estado: 'atendida' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
    expect(prisma.tx.solicitudArco.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 4, estado: 'respondida' },
      data: { estado: 'atendida', atendidaEn: AHORA, atendidaPorId: 'admin-1' },
    });

    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ id: 5, tipo: 'cancelacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' }));
    await expect(servicio(prisma).actualizarAdmin(5, { estado: 'atendida' }, 'admin-1', CONTEXTO_ADMIN, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('atendida exige respuesta: sin la nueva ni una ya dada, 400; directo desde recibida guarda también respondida_en', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'rectificacion' }));
    const error = await errorDe(servicio(prisma).actualizarAdmin(4, { estado: 'atendida' }, 'admin-1', CONTEXTO_ADMIN, AHORA));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Escribe la respuesta para la titular.');
    expect(prisma.tx.solicitudArco.updateMany).not.toHaveBeenCalled();

    await servicio(prisma).actualizarAdmin(4, { estado: 'atendida', respuesta: 'Listo, corregido.' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
    expect(prisma.tx.solicitudArco.updateMany.mock.calls[0][0].data).toMatchObject({
      estado: 'atendida',
      respuesta: 'Listo, corregido.',
      respondidaEn: AHORA,
      atendidaEn: AHORA,
      atendidaPorId: 'admin-1',
    });
  });

  it('una respondida no regresa a en_proceso (400) y no se escribe nada', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'respondida', respondidaEn: AHORA, respuesta: 'Ya' }));
    const error = await errorDe(servicio(prisma).actualizarAdmin(4, { estado: 'en_proceso' }, 'admin-1', CONTEXTO_ADMIN, AHORA));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Una solicitud respondida no puede pasar a "en proceso".');
    expect(prisma.tx.solicitudArco.updateMany).not.toHaveBeenCalled();
  });

  it('volver a responder cambia la respuesta, pero no reinicia vence_efectividad ni respondida_en', async () => {
    const prisma = prismaBase();
    const plazo = new Date('2026-11-25T05:59:59.999Z');
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'respondida', respondidaEn: AHORA, venceEfectividad: plazo, respuesta: 'Primera' }));
    await servicio(prisma).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Segunda, con el detalle' }, 'admin-1', CONTEXTO_ADMIN, new Date('2026-11-20T18:00:00.000Z'));
    const { where, data } = prisma.tx.solicitudArco.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 4, estado: 'respondida' });
    expect(data).toEqual({ estado: 'respondida', respuesta: 'Segunda, con el detalle' });
  });

  it('el cambio es atómico: si otra persona ya cambió el estado (ninguna fila actualizada), 409', async () => {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'en_proceso' }));
    prisma.tx.solicitudArco.updateMany.mockResolvedValue({ count: 0 });
    const correo = correoFalso();
    const error = await errorDe(servicio(prisma, correo).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Hola' }, 'admin-1', CONTEXTO_ADMIN, AHORA));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'SOLICITUD_CAMBIO' });
    expect(correo.sendRespuestaArcoEmail).not.toHaveBeenCalled();
  });

  it('solicitud inexistente: 404; ya cerrada: 400', async () => {
    const prisma = prismaBase();
    await expect(servicio(prisma).actualizarAdmin(99, { estado: 'en_proceso' }, 'admin-1', CONTEXTO_ADMIN, AHORA)).rejects.toBeInstanceOf(NotFoundException);
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'atendida' }));
    await expect(servicio(prisma).actualizarAdmin(4, { estado: 'en_proceso' }, 'admin-1', CONTEXTO_ADMIN, AHORA)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('correo a la titular al responder, atender o rechazar', () => {
    it.each([
      ['respondida', { estado: 'en_proceso' }, { estado: 'respondida', respuesta: 'Te enviamos tus datos.' }, 'Te enviamos tus datos.'],
      ['rechazada', { estado: 'recibida' }, { estado: 'rechazada', respuesta: 'No encontramos datos con ese correo.' }, 'No encontramos datos con ese correo.'],
      ['atendida', { estado: 'respondida', respondidaEn: AHORA, respuesta: 'Corregido.' }, { estado: 'atendida' }, 'Corregido.'],
    ])('%s: folio, estado y respuesta al correo de la titular, después de guardar', async (estado, actual, dto, respuesta) => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'rectificacion', ...actual }));
      const correo = correoFalso();
      // Dentro de la transacción todavía no sale ningún correo
      const original = prisma.$transaction;
      prisma.$transaction = jest.fn(async (fn: any) => {
        const res = await original(fn);
        expect(correo.sendRespuestaArcoEmail).not.toHaveBeenCalled();
        return res;
      });
      const r = await servicio(prisma, correo).actualizarAdmin(4, dto as any, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' }, select: { email: true } });
      expect(correo.sendRespuestaArcoEmail).toHaveBeenCalledTimes(1);
      expect(correo.sendRespuestaArcoEmail).toHaveBeenCalledWith('ana@example.com', {
        folio: 'ARCO-2026-000004',
        tipo: 'rectificacion',
        estado,
        respuesta,
      });
      expect(r).toMatchObject({ success: true, correoEnviado: true });
    });

    it('en_proceso no avisa por correo', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud());
      const correo = correoFalso();
      const r = await servicio(prisma, correo).actualizarAdmin(4, { estado: 'en_proceso' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(correo.sendRespuestaArcoEmail).not.toHaveBeenCalled();
      expect(r).not.toHaveProperty('correoEnviado');
    });

    it('si el correo falla, la respuesta queda guardada y el log no lleva datos personales', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ estado: 'en_proceso' }));
      const correo = correoFalso();
      correo.sendRespuestaArcoEmail.mockRejectedValue(new Error('No se pudo enviar el correo (respuesta ARCO) a ana@example.com'));
      const logs = capturarLogs();
      const r = await servicio(prisma, correo).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Tu teléfono es 5512345678' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(prisma.tx.solicitudArco.updateMany).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ success: true, correoEnviado: false, data: { estado: 'respondida' } });
      const texto = logs.join('\n');
      expect(texto).toMatch(/ARCO-2026-000004|solicitud 4/);
      for (const personal of ['ana@example.com', '5512345678', 'Ana']) expect(texto).not.toContain(personal);
    });
  });

  describe('revocación y oposición atendidas desde la bandeja', () => {
    it('revocación atendida sin elegir consentimientos: 400 "Elige qué consentimientos se revocan."', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' }));
      for (const dto of [{ estado: 'atendida' }, { estado: 'atendida', revocar: [] }]) {
        const error = await errorDe(servicio(prisma).actualizarAdmin(4, dto as any, 'admin-1', CONTEXTO_ADMIN, AHORA));
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toBe('Elige qué consentimientos se revocan.');
      }
      expect(prisma.tx.solicitudArco.updateMany).not.toHaveBeenCalled();
      expect(prisma.tx.consentimiento.create).not.toHaveBeenCalled();
    });

    it('revocación atendida: una fila "revocado" por tipo (arco-bandeja, /admin/solicitudes-arco) y sus efectos, todo por tx', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' }));
      const { tx } = prisma;
      await servicio(prisma).actualizarAdmin(
        4,
        { estado: 'atendida', revocar: ['promociones', 'datos_salud', 'fotos_resultado'] },
        'admin-1',
        CONTEXTO_ADMIN,
        AHORA,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.solicitudArco.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, estado: 'respondida' } }));
      const filas = tx.consentimiento.create.mock.calls.map(([args]: any[]) => args.data);
      expect(filas.map((f: any) => f.tipo)).toEqual(['promociones', 'datos_salud', 'fotos_resultado']);
      for (const fila of filas) {
        expect(fila).toMatchObject({
          usuarioId: 'u-1',
          accion: 'revocado',
          formulario: 'arco-bandeja',
          rutaOrigen: '/admin/solicitudes-arco',
          documentoSlug: null,
          ip: CONTEXTO_ADMIN.ip,
          userAgent: CONTEXTO_ADMIN.userAgent,
          // La fila deja constancia de quién del personal la registró
          registradoPorId: 'admin-1',
        });
      }
      // Efectos en la cuenta: promociones apagadas y datos de salud borrados, en una sola escritura
      expect(tx.usuario.update).toHaveBeenCalledTimes(1);
      expect(tx.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: false, alergias: null } });
    });

    it('revocar solo fotos_resultado deja la fila, sin cambios en la cuenta', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'en_proceso', respuesta: 'Procede' }));
      await servicio(prisma).actualizarAdmin(4, { estado: 'atendida', revocar: ['fotos_resultado'] }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(prisma.tx.consentimiento.create).toHaveBeenCalledTimes(1);
      expect(prisma.tx.usuario.update).not.toHaveBeenCalled();
      // Sus fotos de la galería ligadas a la autorización dejan de verse, en la misma transacción
      expect(prisma.tx.galeriaFoto.updateMany).toHaveBeenCalledWith({
        where: { visible: true, consentimiento: { is: { usuarioId: 'u-1' } } },
        data: { visible: false },
      });
    });

    it('oposición atendida: aplica la oposición a promociones igual que POST /arco/oposicion, por tx', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'oposicion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' }));
      await servicio(prisma).actualizarAdmin(4, { estado: 'atendida' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(prisma.tx.usuario.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { recibePromociones: false } });
      expect(prisma.tx.consentimiento.create).toHaveBeenCalledTimes(1);
      expect(prisma.tx.consentimiento.create.mock.calls[0][0].data).toMatchObject({
        usuarioId: 'u-1',
        tipo: 'promociones',
        accion: 'revocado',
        formulario: 'arco-bandeja',
        rutaOrigen: '/admin/solicitudes-arco',
        registradoPorId: 'admin-1',
      });
    });

    it('oposición o revocación que no se atienden (respondida, rechazada) no tocan consentimientos ni la cuenta', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'oposicion', estado: 'en_proceso' }));
      await servicio(prisma).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Lo revisamos' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'en_proceso' }));
      await servicio(prisma).actualizarAdmin(4, { estado: 'rechazada', respuesta: 'No procede' }, 'admin-1', CONTEXTO_ADMIN, AHORA);
      expect(prisma.tx.consentimiento.create).not.toHaveBeenCalled();
      expect(prisma.tx.usuario.update).not.toHaveBeenCalled();
    });

    it('revocar en otra solicitud o en otro estado: 400 y no se escribe nada', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'acceso', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Ya' }));
      await expect(
        servicio(prisma).actualizarAdmin(4, { estado: 'atendida', revocar: ['promociones'] }, 'admin-1', CONTEXTO_ADMIN, AHORA),
      ).rejects.toBeInstanceOf(BadRequestException);
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'en_proceso' }));
      await expect(
        servicio(prisma).actualizarAdmin(4, { estado: 'respondida', respuesta: 'Ok', revocar: ['promociones'] }, 'admin-1', CONTEXTO_ADMIN, AHORA),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tx.solicitudArco.updateMany).not.toHaveBeenCalled();
      expect(prisma.tx.consentimiento.create).not.toHaveBeenCalled();
    });

    it('si falla la fila de consentimiento, el error sale de la transacción y no se avisa por correo', async () => {
      const prisma = prismaBase();
      prisma.solicitudArco.findUnique.mockResolvedValue(solicitud({ tipo: 'revocacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' }));
      prisma.tx.consentimiento.create.mockRejectedValue(new Error('falla simulada'));
      const correo = correoFalso();
      await expect(
        servicio(prisma, correo).actualizarAdmin(4, { estado: 'atendida', revocar: ['promociones'] }, 'admin-1', CONTEXTO_ADMIN, AHORA),
      ).rejects.toThrow('falla simulada');
      expect(correo.sendRespuestaArcoEmail).not.toHaveBeenCalled();
    });
  });
});

describe('ArcoService.ejecutarCancelacion: anonimiza y conserva lo fiscal y legal', () => {
  const SOLICITUD = { id: 7, folio: 'ARCO-2026-000007', usuarioId: 'u-1', tipo: 'cancelacion', estado: 'respondida', respondidaEn: AHORA, respuesta: 'Procede' };
  const CONSERVADOS = ['pago', 'factura', 'consentimiento', 'queja', 'valoracion'];
  const prohibido = () => {
    throw new Error('no se debe tocar');
  };

  function escenarioCancelacion(solicitud: any = SOLICITUD) {
    const prisma = prismaBase();
    prisma.solicitudArco.findUnique.mockResolvedValue(solicitud);
    // Lo que se conserva: si el servicio intentara modificarlo o borrarlo (con tx o sin ella), la prueba falla
    for (const cliente of [prisma, prisma.tx]) {
      for (const modelo of CONSERVADOS) {
        cliente[modelo] = { ...(cliente[modelo] ?? {}), create: jest.fn(prohibido), update: jest.fn(prohibido), updateMany: jest.fn(prohibido), delete: jest.fn(prohibido), deleteMany: jest.fn(prohibido) };
      }
      for (const modelo of ['pedido', 'ventaLocal', 'cita', 'cotizacion', 'usuario']) {
        cliente[modelo] = { ...cliente[modelo], delete: jest.fn(prohibido), deleteMany: jest.fn(prohibido) };
      }
    }
    return prisma;
  }

  it('deja los datos personales en null, cuenta inactiva con sesiones revocadas, y borra tarjetas y carrito (por tx)', async () => {
    const prisma = escenarioCancelacion();
    await servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.tx.usuario.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        nombre: 'Cuenta cancelada',
        email: 'cancelada-u-1@anonimo.invalid',
        telefono: null,
        foto: null,
        googleId: null,
        fechaNacimiento: null,
        preguntaSeguridad: null,
        respuestaSeguridad: null,
        password: null,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        codigoOTP: null,
        otpExpira: null,
        tipoCabello: null,
        colorNatural: null,
        colorActual: null,
        productosUsados: null,
        alergias: null,
        tratamientosQuimicos: false,
        tratamientos: null,
        recibePromociones: false,
        activo: false,
        tokensRevocadosDesde: AHORA,
      },
    });
    expect(prisma.tx.metodoPagoUsuario.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u-1' } });
    expect(prisma.tx.carritoItem.deleteMany).toHaveBeenCalledWith({ where: { usuarioId: 'u-1' } });
    expect(prisma.tx.direccionUsuario.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: 'u-1' },
      data: { calle: 'Dirección eliminada', numeroInterior: null, indicaciones: null, contactoNombreApellido: 'Cuenta cancelada', contactoTelefono: '' },
    });
  });

  it('cada escritura va por tx (en el prisma raíz lanzan) y limpia lo que no es obligación fiscal', async () => {
    const prisma = escenarioCancelacion();
    await servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA);
    const { tx } = prisma;
    const esperadas: Array<[string, string, unknown]> = [
      ['metodoPagoUsuario', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      // Cuenta cancelada: sus fotos autorizadas dejan de verse en la galería
      ['galeriaFoto', 'updateMany', { where: { visible: true, consentimiento: { is: { usuarioId: 'u-1' } } }, data: { visible: false } }],
      ['carritoItem', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['dispositivoPush', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['solicitudCambioCorreo', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['notificacion', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['observacionCliente', 'deleteMany', { where: { clienteId: 'u-1' } }],
      ['sesionMovil', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['preferenciaNotificacion', 'deleteMany', { where: { usuarioId: 'u-1' } }],
      ['cita', 'updateMany', { where: { clienteId: 'u-1' }, data: { notas: null } }],
      ['pedido', 'updateMany', { where: { usuarioId: 'u-1' }, data: { direccionTextoCompleta: null, notasCliente: null } }],
      ['cotizacion', 'updateMany', { where: { clienteId: 'u-1' }, data: { clienteNombre: 'Cuenta cancelada', notas: null } }],
      // notas es NOT NULL: el texto vacío es su valor "sin dato"
      ['seguimientoPostServicio', 'updateMany', { where: { usuarioId: 'u-1' }, data: { notas: '' } }],
      ['ventaLocal', 'updateMany', { where: { clienteId: 'u-1' }, data: { notas: null } }],
    ];
    for (const [modelo, op, args] of esperadas) {
      expect(tx[modelo][op]).toHaveBeenCalledTimes(1);
      expect(tx[modelo][op]).toHaveBeenCalledWith(args);
    }
    expect(tx.usuario.update).toHaveBeenCalledTimes(1);
    expect(tx.direccionUsuario.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.solicitudArco.updateMany).toHaveBeenCalledTimes(1);
  });

  it('conserva pedidos, pagos, facturas, ventas, citas, quejas, valoraciones y consentimientos, y marca la solicitud atendida de forma atómica', async () => {
    const prisma = escenarioCancelacion();
    const r = await servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA);
    for (const cliente of [prisma, prisma.tx]) {
      for (const modelo of CONSERVADOS) {
        for (const op of ['create', 'update', 'updateMany', 'delete', 'deleteMany']) expect(cliente[modelo][op]).not.toHaveBeenCalled();
      }
      for (const modelo of ['pedido', 'ventaLocal', 'cita', 'cotizacion', 'usuario']) {
        expect(cliente[modelo].delete).not.toHaveBeenCalled();
        expect(cliente[modelo].deleteMany).not.toHaveBeenCalled();
      }
    }
    // De pedidos y ventas solo se vacían la dirección y las notas: montos, estados y fechas quedan
    expect(Object.keys(prisma.tx.pedido.updateMany.mock.calls[0][0].data).sort()).toEqual(['direccionTextoCompleta', 'notasCliente']);
    expect(Object.keys(prisma.tx.ventaLocal.updateMany.mock.calls[0][0].data)).toEqual(['notas']);
    expect(prisma.tx.solicitudArco.updateMany).toHaveBeenCalledWith({
      where: { id: 7, estado: 'respondida' },
      data: expect.objectContaining({ estado: 'atendida', atendidaEn: AHORA, atendidaPorId: 'admin-1' }),
    });
    expect(r).toMatchObject({ success: true, message: 'Cuenta anonimizada y solicitud atendida.', data: { folio: 'ARCO-2026-000007' } });
  });

  it('si otra persona ya la ejecutó (ninguna fila actualizada), 409 y no se anonimiza ni se manda correo', async () => {
    const prisma = escenarioCancelacion();
    prisma.tx.solicitudArco.updateMany.mockResolvedValue({ count: 0 });
    const correo = correoFalso();
    const error = await errorDe(servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA));
    expect(error).toBeInstanceOf(ConflictException);
    expect(prisma.tx.usuario.update).not.toHaveBeenCalled();
    expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
  });

  it('sin respuesta previa, la ejecución cuenta como respuesta y nombra lo que se conserva', async () => {
    const prisma = escenarioCancelacion({ ...SOLICITUD, estado: 'recibida', respondidaEn: null, respuesta: null });
    await servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA);
    const { where, data } = prisma.tx.solicitudArco.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 7, estado: 'recibida' });
    expect(data).toMatchObject({ respondidaEn: AHORA, respuesta: expect.stringContaining('anonimiz') });
    for (const conservado of ['pedidos', 'pagos', 'facturas', 'ventas', 'citas', 'quejas', 'valoraciones', 'consentimientos', 'solicitudes ARCO']) {
      expect(data.respuesta).toContain(conservado);
    }
  });

  it('cuenta del personal: 409 "primero quítale el rol de personal" y no anonimiza', async () => {
    const prisma = escenarioCancelacion();
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-1', nombre: 'Eli', email: 'eli@example.com', rol: 'estilista' });
    const correo = correoFalso();
    const error = await errorDe(servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ message: 'Esta cuenta es del personal: primero quítale el rol de personal.', code: 'CUENTA_DE_PERSONAL' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
  });

  it('cuenta las operaciones abiertas de la titular: pedidos sin terminar, citas activas que no han terminado y devoluciones pendientes', async () => {
    const prisma = escenarioCancelacion();
    await servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA);
    expect(prisma.usuario.findUnique.mock.calls[0][0]).toMatchObject({ where: { id: 'u-1' } });
    expect(prisma.pedido.count).toHaveBeenCalledWith({ where: { usuarioId: 'u-1', estado: { notIn: ['entregado', 'cancelado', 'borrador'] } } });
    expect(prisma.cita.count).toHaveBeenCalledWith({
      where: {
        clienteId: 'u-1',
        OR: [{ estado: { in: ['pendiente', 'confirmada', 'reprogramada'] }, fechaHoraFin: { gte: AHORA } }, { estado: 'en_curso' }],
      },
    });
    expect(prisma.devolucion.count).toHaveBeenCalledWith({ where: { pedido: { usuarioId: 'u-1' }, estado: 'pendiente' } });
  });

  it.each([
    [1, 2, 0, 'Tiene 1 pedido y 2 citas en curso: termínalos o cancélalos antes de anonimizar.'],
    [1, 0, 0, 'Tiene 1 pedido en curso: termínalo o cancélalo antes de anonimizar.'],
    [0, 1, 0, 'Tiene 1 cita en curso: termínala o cancélala antes de anonimizar.'],
    [0, 0, 2, 'Tiene 2 devoluciones en curso: termínalas o cancélalas antes de anonimizar.'],
    [2, 1, 1, 'Tiene 2 pedidos, 1 cita y 1 devolución en curso: termínalos o cancélalos antes de anonimizar.'],
  ])('con %i pedidos, %i citas y %i devoluciones en curso: 409 con el detalle y no anonimiza', async (pedidos, citas, devoluciones, mensaje) => {
    const prisma = escenarioCancelacion();
    prisma.pedido.count.mockResolvedValue(pedidos);
    prisma.cita.count.mockResolvedValue(citas);
    prisma.devolucion.count.mockResolvedValue(devoluciones);
    const correo = correoFalso();
    const error = await errorDe(servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ message: mensaje, code: 'OPERACIONES_EN_CURSO' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
  });

  it('después del commit manda la confirmación al correo ORIGINAL (leído antes de anonimizar)', async () => {
    const prisma = escenarioCancelacion();
    const correo = correoFalso();
    const original = prisma.$transaction;
    prisma.$transaction = jest.fn(async (fn: any) => {
      const res = await original(fn);
      // Al terminar el callback (antes del commit) todavía no salió el correo
      expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
      return res;
    });
    const r = await servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA);
    expect(correo.sendCancelacionCuentaArcoEmail).toHaveBeenCalledTimes(1);
    expect(correo.sendCancelacionCuentaArcoEmail).toHaveBeenCalledWith('ana@example.com', { folio: 'ARCO-2026-000007', fecha: AHORA });
    expect(r).toMatchObject({ success: true, data: { folio: 'ARCO-2026-000007', correoEnviado: true } });
  });

  it('si la transacción falla no se manda el correo', async () => {
    const prisma = escenarioCancelacion();
    prisma.tx.cotizacion.updateMany.mockRejectedValue(new Error('falla simulada'));
    const correo = correoFalso();
    await expect(servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA)).rejects.toThrow('falla simulada');
    expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
  });

  it('si el correo falla, la cancelación queda hecha y el log no lleva datos personales', async () => {
    const prisma = escenarioCancelacion();
    const correo = correoFalso();
    correo.sendCancelacionCuentaArcoEmail.mockRejectedValue(new Error('No se pudo enviar a ana@example.com'));
    const logs = capturarLogs();
    const r = await servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA);
    expect(r).toMatchObject({ success: true, data: { correoEnviado: false } });
    const texto = logs.join('\n');
    expect(texto).toMatch(/ARCO-2026-000007|solicitud 7/);
    for (const personal of ['ana@example.com', 'Ana']) expect(texto).not.toContain(personal);
  });

  it('una cuenta ya anonimizada no recibe correo (su dirección no existe)', async () => {
    const prisma = escenarioCancelacion();
    prisma.usuario.findUnique.mockResolvedValue({ id: 'u-1', nombre: 'Cuenta cancelada', email: 'cancelada-u-1@anonimo.invalid', rol: 'cliente' });
    const correo = correoFalso();
    const r = await servicio(prisma, correo).ejecutarCancelacion(7, 'admin-1', AHORA);
    expect(correo.sendCancelacionCuentaArcoEmail).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: true, data: { correoEnviado: false } });
  });

  it.each([
    ['otro tipo de solicitud', { ...SOLICITUD, tipo: 'acceso', estado: 'recibida' }, BadRequestException],
    ['ya atendida', { ...SOLICITUD, estado: 'atendida' }, BadRequestException],
    ['rechazada', { ...SOLICITUD, estado: 'rechazada' }, BadRequestException],
    ['inexistente', null, NotFoundException],
  ])('%s: no anonimiza', async (_caso, solicitud, error) => {
    const prisma = escenarioCancelacion(solicitud);
    await expect(servicio(prisma).ejecutarCancelacion(7, 'admin-1', AHORA)).rejects.toBeInstanceOf(error);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.tx.usuario.update).not.toHaveBeenCalled();
    expect(prisma.tx.metodoPagoUsuario.deleteMany).not.toHaveBeenCalled();
  });
});

describe('Permisos de /arco', () => {
  const RUTAS_ADMIN = ['listarAdmin', 'actualizarAdmin', 'ejecutarCancelacion'];
  const RUTAS_CLIENTA = ['crearSolicitud', 'mias', 'misDatos', 'oposicion'];
  const nombres = (handler: any) => (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []).map((g: any) => (typeof g === 'function' ? g.name : g.constructor.name));

  it('las rutas de la bandeja llevan JwtAuthGuard + PermisosGuard con la clave "*"; las de la clienta, solo sesión', () => {
    for (const r of RUTAS_ADMIN) {
      expect(nombres(ArcoController.prototype[r])).toEqual(['JwtAuthGuard', 'PermisosGuard']);
      expect(Reflect.getMetadata('permisos', ArcoController.prototype[r])).toEqual(['*']);
    }
    for (const r of RUTAS_CLIENTA) {
      expect(nombres(ArcoController.prototype[r])).toContain('JwtAuthGuard');
      expect(nombres(ArcoController.prototype[r])).not.toContain('PermisosGuard');
    }
  });

  it('POST /solicitudes, POST /oposicion y GET /mis-datos llevan límite de peticiones (RateLimitGuard) después de la sesión', () => {
    for (const [h, max] of [['crearSolicitud', 5], ['oposicion', 5], ['misDatos', 10]] as const) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, ArcoController.prototype[h]);
      expect(guards[0]).toBe(JwtAuthGuard);
      const limite = guards.find((g: unknown) => g instanceof RateLimitGuard);
      expect(limite).toBeDefined();
      expect(limite.maxRequests).toBe(max);
      expect(limite.windowMs).toBe(60000);
    }
  });

  it('ArcoModule importa EmailModule (correos de la respuesta y de la cancelación)', () => {
    expect(Reflect.getMetadata('imports', ArcoModule)).toContain(EmailModule);
  });

  it('PermisosGuard real: la clienta queda fuera de la bandeja (403) y el admin entra', async () => {
    const claves: Record<string, string[]> = { admin: ['*'], cliente: ['tienda:propia', 'citas:propia', 'perfil:propio'], estilista: ['clientes:lectura'] };
    const prisma: any = {
      usuario: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, rol: where.id.split('-')[0] })) },
      permisoRol: { findUnique: jest.fn(async ({ where }: any) => ({ claves: claves[where.rol] })) },
    };
    const guard = new PermisosGuard(new Reflector(), prisma);
    const ctx = (id: string) =>
      ({
        getHandler: () => ArcoController.prototype.listarAdmin,
        getClass: () => ArcoController,
        switchToHttp: () => ({ getRequest: () => ({ user: { id } }) }),
      }) as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx('cliente-1'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx('estilista-1'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx('admin-1'))).resolves.toBe(true);
  });
});

describe('Rutas /api/arco', () => {
  let app: INestApplication;
  let base: string;
  const servicioRutas = {
    crearSolicitud: jest.fn(),
    mias: jest.fn(),
    misDatos: jest.fn(),
    oposicion: jest.fn(),
    listarAdmin: jest.fn(),
    actualizarAdmin: jest.fn(),
    ejecutarCancelacion: jest.fn(),
  };
  const sesion: CanActivate = {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const id = req.headers['x-usuaria'];
      if (!id) return false;
      req.user = { id, rol: req.headers['x-rol'] ?? 'cliente' };
      return true;
    },
  };
  const soloAdmin: CanActivate = { canActivate: (ctx) => ctx.switchToHttp().getRequest().user?.rol === 'admin' };

  const limpiarLimites = () => {
    for (const h of ['crearSolicitud', 'oposicion', 'misDatos']) {
      for (const g of Reflect.getMetadata(GUARDS_METADATA, ArcoController.prototype[h]) ?? []) {
        if (g instanceof RateLimitGuard) (g as any).requests.clear();
      }
    }
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [ArcoController],
      providers: [{ provide: ArcoService, useValue: servicioRutas }, { provide: PrismaService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(sesion)
      .overrideGuard(PermisosGuard)
      .useValue(soloAdmin)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    limpiarLimites();
    for (const fn of Object.values(servicioRutas)) fn.mockReset().mockResolvedValue({ success: true, data: {} });
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/arco${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const clienta = { 'x-usuaria': 'u-1' };
  const admin = { 'x-usuaria': 'admin-1', 'x-rol': 'admin' };

  it('POST /solicitudes: 201 con la usuaria de la sesión; tipo inválido o campos de más, 400', async () => {
    const r = await pedir('POST', '/solicitudes', { tipo: 'rectificacion', descripcion: 'Mi teléfono cambió' }, clienta);
    expect(r.status).toBe(201);
    expect(servicioRutas.crearSolicitud).toHaveBeenCalledWith('u-1', expect.objectContaining({ tipo: 'rectificacion', descripcion: 'Mi teléfono cambió' }));
    expect((await pedir('POST', '/solicitudes', { tipo: 'borrar-todo' }, clienta)).status).toBe(400);
    expect((await pedir('POST', '/solicitudes', { tipo: 'acceso', usuarioId: 'otra' }, clienta)).status).toBe(400);
    expect((await pedir('POST', '/solicitudes', { tipo: 'acceso', estado: 'atendida' }, clienta)).status).toBe(400);
    expect(servicioRutas.crearSolicitud).toHaveBeenCalledTimes(1);
  });

  it('POST /solicitudes con una cancelación abierta: 409 con el mensaje y el código', async () => {
    servicioRutas.crearSolicitud.mockRejectedValue(
      new ConflictException({ message: 'Ya tienes una solicitud de cancelación abierta con folio ARCO-2026-000003.', code: 'CANCELACION_ABIERTA' }),
    );
    const r = await pedir('POST', '/solicitudes', { tipo: 'cancelacion' }, clienta);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      success: false,
      message: 'Ya tienes una solicitud de cancelación abierta con folio ARCO-2026-000003.',
      code: 'CANCELACION_ABIERTA',
    });
  });

  it('GET /mias y /mis-datos usan la usuaria de la sesión (no aceptan otra por query)', async () => {
    await pedir('GET', '/mias?usuarioId=otra', undefined, clienta);
    expect(servicioRutas.mias).toHaveBeenCalledWith('u-1');
    await pedir('GET', '/mis-datos', undefined, clienta);
    expect(servicioRutas.misDatos).toHaveBeenCalledWith('u-1');
  });

  it('POST /oposicion: solo finalidad promociones; pasa ip y user agent', async () => {
    const r = await pedir('POST', '/oposicion', { finalidad: 'promociones' }, { ...clienta, 'x-forwarded-for': '201.1.1.1', 'user-agent': 'Navegador de prueba' });
    expect(r.status).toBe(201);
    // ip: req.ip (la de la conexión, como el límite de peticiones); el x-forwarded-for de quien pide no cuenta
    expect(servicioRutas.oposicion).toHaveBeenCalledWith('u-1', expect.objectContaining({ finalidad: 'promociones' }), { ip: '127.0.0.1', userAgent: 'Navegador de prueba' });
    expect((await pedir('POST', '/oposicion', { finalidad: 'todo' }, clienta)).status).toBe(400);
  });

  it('al pasar el límite de peticiones responde 429 en español', async () => {
    for (let i = 0; i < 5; i++) expect((await pedir('POST', '/oposicion', { finalidad: 'promociones' }, clienta)).status).toBe(201);
    const r = await pedir('POST', '/oposicion', { finalidad: 'promociones' }, clienta);
    expect(r.status).toBe(429);
    expect((await r.json()).message).toMatch(/^Demasiadas solicitudes/);
    expect(servicioRutas.oposicion).toHaveBeenCalledTimes(5);
  });

  it('bandeja: la clienta recibe 403 en GET, PATCH y ejecutar-cancelacion', async () => {
    expect((await pedir('GET', '/solicitudes', undefined, clienta)).status).toBe(403);
    expect((await pedir('PATCH', '/solicitudes/4', { estado: 'en_proceso' }, clienta)).status).toBe(403);
    expect((await pedir('POST', '/solicitudes/4/ejecutar-cancelacion', undefined, clienta)).status).toBe(403);
    expect(servicioRutas.listarAdmin).not.toHaveBeenCalled();
    expect(servicioRutas.actualizarAdmin).not.toHaveBeenCalled();
    expect(servicioRutas.ejecutarCancelacion).not.toHaveBeenCalled();
  });

  it('bandeja del admin: filtros, PATCH con id numérico, estado válido y contexto de la petición, y ejecutar-cancelacion', async () => {
    expect((await pedir('GET', '/solicitudes?estado=recibida&vencidas=true&page=2&limit=5', undefined, admin)).status).toBe(200);
    expect(servicioRutas.listarAdmin).toHaveBeenCalledWith({ estado: 'recibida', vencidas: 'true', page: '2', limit: '5' });
    expect((await pedir('GET', '/solicitudes?estado=borrada', undefined, admin)).status).toBe(400);

    const conContexto = { ...admin, 'x-forwarded-for': CONTEXTO_ADMIN.ip, 'user-agent': CONTEXTO_ADMIN.userAgent };
    expect((await pedir('PATCH', '/solicitudes/4', { estado: 'respondida', respuesta: 'Listo' }, conContexto)).status).toBe(200);
    expect(servicioRutas.actualizarAdmin).toHaveBeenCalledWith(4, expect.objectContaining({ estado: 'respondida', respuesta: 'Listo' }), 'admin-1', {
      ip: '127.0.0.1',
      userAgent: CONTEXTO_ADMIN.userAgent,
    });
    expect((await pedir('PATCH', '/solicitudes/4', { estado: 'recibida' }, admin)).status).toBe(400);
    expect((await pedir('PATCH', '/solicitudes/abc', { estado: 'en_proceso' }, admin)).status).toBe(400);

    expect((await pedir('POST', '/solicitudes/7/ejecutar-cancelacion', undefined, admin)).status).toBe(200);
    expect(servicioRutas.ejecutarCancelacion).toHaveBeenCalledWith(7, 'admin-1');
  });

  it('PATCH con revocar: lista de promociones, datos_salud o fotos_resultado; otro valor, texto o repetidos, 400', async () => {
    const ok = await pedir('PATCH', '/solicitudes/4', { estado: 'atendida', revocar: ['promociones', 'datos_salud', 'fotos_resultado'] }, admin);
    expect(ok.status).toBe(200);
    expect(servicioRutas.actualizarAdmin).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ estado: 'atendida', revocar: ['promociones', 'datos_salud', 'fotos_resultado'] }),
      'admin-1',
      expect.any(Object),
    );
    for (const revocar of [['terminos'], 'promociones', ['promociones', 'promociones'], [7]]) {
      expect((await pedir('PATCH', '/solicitudes/4', { estado: 'atendida', revocar }, admin)).status).toBe(400);
    }
    expect(servicioRutas.actualizarAdmin).toHaveBeenCalledTimes(1);
  });
});
