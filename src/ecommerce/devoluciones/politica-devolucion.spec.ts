import { BadRequestException } from '@nestjs/common';
import { motivoConPolitica, validarPoliticaDevolucion } from './politica-devolucion';
import { DevolucionesService } from './devoluciones.service';

/**
 * Política de los términos: cambio por producto sellado y sin abrir (o defecto de fábrica) dentro de
 * 7 días naturales tras recogerlo; reembolso solo por defecto, error (producto distinto), falta de
 * existencias o cancelación de un pedido pagado en línea antes de estar listo.
 */
const AHORA = new Date('2026-10-20T18:00:00.000Z'); // 20 oct, 12:00 en México
const entregado = (dia: string) => ({ estado: 'entregado', pagadoEn: new Date(`${dia}T17:00:00.000Z`), metodoPago: 'pago_en_salon', entregadoEn: new Date(`${dia}T17:00:00.000Z`), llegoAListo: true });

describe('Política de cambios y reembolsos', () => {
  it('cambio de producto sellado dentro de 7 días naturales: permitido', () => {
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, pedidoItemId: 3, pedido: entregado('2026-10-13') }, AHORA)).toBeNull();
  });

  it('cambio a los 8 días: rechazado', () => {
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, pedidoItemId: 3, pedido: entregado('2026-10-12') }, AHORA)).toMatch(/7 días/);
  });

  it('cambio sin confirmar que está sellado: rechazado', () => {
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: false, pedidoItemId: 3, pedido: entregado('2026-10-18') }, AHORA)).toMatch(/sellado/);
  });

  it('cambio de un producto abierto solo por defecto de fábrica', () => {
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'defecto_fabrica', pedidoItemId: 3, pedido: entregado('2026-10-18') }, AHORA)).toBeNull();
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'producto_distinto' as any, pedidoItemId: 3, pedido: entregado('2026-10-18') }, AHORA)).toMatch(/no aplica/);
  });

  it('un pedido que no se ha entregado no admite cambio', () => {
    expect(validarPoliticaDevolucion({ tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, pedidoItemId: 3, pedido: { ...entregado('2026-10-18'), estado: 'listo_recoger', entregadoEn: null } }, AHORA)).toMatch(/entregado/);
  });

  it('reembolso por defecto o por producto distinto: con el artículo y el pedido entregado', () => {
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'defecto_fabrica', pedidoItemId: 3, pedido: entregado('2026-10-01') }, AHORA)).toBeNull();
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'producto_distinto', pedidoItemId: 3, pedido: entregado('2026-10-01') }, AHORA)).toBeNull();
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'producto_distinto', pedido: entregado('2026-10-01') }, AHORA)).toMatch(/artículo/);
  });

  it('reembolso por arrepentimiento (producto sellado) no existe: solo cambio', () => {
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'sellado_sin_abrir' as any, pedidoItemId: 3, pedido: entregado('2026-10-18') }, AHORA)).toMatch(/no aplica/);
  });

  it('reembolso por falta de existencias: pedido pagado y cancelado por el salón', () => {
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'sin_existencias', pedido: { estado: 'cancelado', pagadoEn: AHORA, metodoPago: 'mercado_pago', entregadoEn: null, llegoAListo: false } }, AHORA)).toBeNull();
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'sin_existencias', pedido: { estado: 'cancelado', pagadoEn: null, metodoPago: 'pago_en_salon', entregadoEn: null, llegoAListo: false } }, AHORA)).toMatch(/pagado/);
  });

  it('reembolso por cancelar un pedido pagado en línea antes de estar listo', () => {
    const base = { estado: 'cancelado', pagadoEn: AHORA, metodoPago: 'mercado_pago', entregadoEn: null };
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'cancelacion_antes_listo', pedido: { ...base, llegoAListo: false } }, AHORA)).toBeNull();
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'cancelacion_antes_listo', pedido: { ...base, llegoAListo: true } }, AHORA)).toMatch(/listo/);
    expect(validarPoliticaDevolucion({ tipo: 'reembolso', causa: 'cancelacion_antes_listo', pedido: { ...base, metodoPago: 'pago_en_salon', llegoAListo: false } }, AHORA)).toMatch(/en línea/);
  });

  it('el motivo guarda el tipo y la causa legibles', () => {
    expect(motivoConPolitica('cambio', 'sellado_sin_abrir', 'Quiere otro tono')).toBe('[Cambio · Producto sellado y sin abrir] Quiere otro tono');
  });
});

describe('POST /devoluciones con tipo y causa', () => {
  function montar(pedido: any) {
    const create = jest.fn(async ({ data }: any) => ({ id: 1, ...data }));
    const prisma: any = {
      // 'adm-…' es admin (gestiona solicitudes ajenas); el resto, clienta.
      usuario: { findUnique: jest.fn(async ({ where }: any) => ({ rol: String(where.id).startsWith('adm') ? 'admin' : 'cliente' })) },
      permisoRol: { findUnique: jest.fn(async () => ({ claves: ['tienda:propia'] })) },
      pedido: { findUnique: jest.fn(async () => pedido) },
      pedidoItem: { findUnique: jest.fn(async () => ({ id: 3, pedidoId: 9, subtotal: '100.00' })) },
      devolucion: { create, findFirst: jest.fn(async () => null) },
      $executeRaw: jest.fn(async () => 1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const servicio = new DevolucionesService(prisma);
    return { servicio, create };
  }
  const pedido = { id: 9, usuarioId: 'cli-1', estado: 'entregado', pagadoEn: new Date(), metodoPago: 'pago_en_salon', total: '100.00', historialEstado: [{ estadoNuevo: 'listo_recoger', creadoEn: new Date() }, { estadoNuevo: 'entregado', creadoEn: new Date() }] };

  it('aplica la política y guarda el motivo con tipo y causa', async () => {
    const { servicio, create } = montar(pedido);
    await servicio.crear('adm-1', { pedidoId: 9, pedidoItemId: 3, estado: 'pendiente', tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, motivo: 'Otro tono' } as any);
    expect(create.mock.calls[0][0].data).toMatchObject({ estado: 'pendiente', motivo: '[Cambio · Producto sellado y sin abrir] Otro tono' });
  });

  it('aplica la política y guarda tipo, causa y el detalle', async () => {
    const { servicio, create } = montar(pedido);
    await servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true, motivo: 'Otro tono' });
    expect(create.mock.calls[0][0].data).toMatchObject({ estado: 'pendiente', tipo: 'cambio', causa: 'sellado_sin_abrir', motivo: '[Cambio · Producto sellado y sin abrir] Otro tono' });
  });

  it('si la política no se cumple responde 400 y no guarda', async () => {
    const { servicio, create } = montar({ ...pedido, estado: 'preparando', historialEstado: [] });
    await expect(servicio.crear('cli-1', { pedidoId: 9, pedidoItemId: 3, tipo: 'cambio', causa: 'sellado_sin_abrir', sellado: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  // Comportamiento cambiado a pedido (B1): el tipo es obligatorio.
  it('sin tipo (solicitud de la clienta desde su portal) funciona como antes', async () => {
    const { servicio, create } = montar(pedido);
    await expect(servicio.crear('cli-1', { pedidoId: 9, estado: 'pendiente', motivo: 'No me gustó' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('sin tipo (como mandaba antes el portal) responde 400 y no guarda', async () => {
    const { servicio, create } = montar(pedido);
    await expect(servicio.crear('cli-1', { pedidoId: 9, motivo: 'No me gustó' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
