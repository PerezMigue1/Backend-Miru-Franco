import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateVentaDto } from './dto/create-venta.dto';
import { PosService } from './pos.service';

/**
 * Cobro en el punto de venta: el precio sale de la base, el descuento lleva motivo, el pago mixto se
 * desglosa y suma el total, y una cita se cobra una sola vez con sus participantes y comisiones.
 */
type CitaMem = { id: number; estado: string; servicioId: number; especialistaId: string; ventaItem: { id: number } | null };

function montar(opciones: { citas?: CitaMem[]; comision?: { servicioId: number; monto: number; activo: boolean } | null; recibe?: string[]; errorAlCrear?: unknown } = {}) {
  const citas = opciones.citas ?? [];
  const personal = [
    { id: 'est-1', rol: 'estilista', activo: true },
    { id: 'aux-1', rol: 'empleado', activo: true },
    { id: 'bec-1', rol: 'becario', activo: true },
    { id: 'cli-9', rol: 'cliente', activo: true },
    { id: 'est-baja', rol: 'estilista', activo: false },
  ];
  const creadas: any[] = [];
  const tx: any = {
    ventaLocal: {
      create: jest.fn(async ({ data }: any) => {
        if (opciones.errorAlCrear) throw opciones.errorAlCrear;
        creadas.push(data);
        return { id: 7, ...data };
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 7, ...creadas[creadas.length - 1], ...data, clienteId: null })),
    },
  };
  const prisma: any = {
    productoPresentacion: { findUnique: jest.fn(async () => ({ id: 3, precio: new Prisma.Decimal(250), stock: 10, disponible: true })) },
    servicio: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, precio: new Prisma.Decimal(where.id === 5 ? 900 : 300), activo: true })) },
    cita: { findUnique: jest.fn(async ({ where }: any) => citas.find((c) => c.id === where.id) ?? null) },
    usuario: { findMany: jest.fn(async ({ where }: any) => personal.filter((u) => where.id.in.includes(u.id))) },
    perfilEmpleado: { findMany: jest.fn(async ({ where }: any) => (opciones.recibe ?? []).filter((id) => where.usuarioId.in.includes(id)).map((usuarioId) => ({ usuarioId, recibeComisiones: true }))) },
    pago: { findMany: jest.fn(async () => []) },
    comisionServicio: { findUnique: jest.fn(async ({ where }: any) => (opciones.comision && opciones.comision.servicioId === where.servicioId ? { ...opciones.comision, monto: new Prisma.Decimal(opciones.comision.monto) } : null)) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const inventario = { registrarSalida: jest.fn(async () => ({})) };
  const pos = new PosService(prisma, inventario as any, { emit: jest.fn() } as any);
  return { pos, creadas, prisma };
}

const producto = (extra: Record<string, unknown> = {}) => ({ presentacionId: 3, cantidad: 2, ...extra });

describe('Precio: el backend ignora el que manda el frontend', () => {
  it('cobra el precio de producto_presentaciones aunque el frontend mande otro', async () => {
    const { pos, creadas } = montar();
    await pos.crearVenta({ metodoPago: 'efectivo', items: [producto({ precioUnitario: 1 })] } as any, 'caj-1');
    expect(Number(creadas[0].items.create[0].precioUnitario)).toBe(250);
    expect(Number(creadas[0].total)).toBe(500);
  });

  it('cobra el precio de servicios.precio en las líneas de servicio', async () => {
    const { pos, creadas } = montar();
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 8, cantidad: 1, precioUnitario: 10 }] } as any, 'caj-1');
    expect(Number(creadas[0].items.create[0].precioUnitario)).toBe(300);
  });
});

describe('Descuento: solo por el campo descuento y con motivo', () => {
  it('descuento mayor a 0 sin motivo responde 400', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'efectivo', descuento: 50, items: [producto()] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('con motivo se aplica y el motivo queda en las notas', async () => {
    const { pos, creadas } = montar();
    await pos.crearVenta({ metodoPago: 'efectivo', descuento: 50, motivoDescuento: 'Clienta frecuente', items: [producto()] } as any, 'caj-1');
    expect(Number(creadas[0].total)).toBe(450);
    expect(creadas[0].notas).toContain('Descuento: Clienta frecuente');
  });

  it('un descuento mayor al subtotal responde 400', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'efectivo', descuento: 600, motivoDescuento: 'x', items: [producto()] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Pago mixto: desglose obligatorio que suma el total', () => {
  it('sin desglose responde 400', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'mixto', items: [producto()] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('si el desglose no suma el total responde 400', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'mixto', pagos: { efectivo: 200, tarjeta: 200 }, items: [producto()] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('con desglose exacto guarda los tres montos', async () => {
    const { pos, creadas } = montar();
    await pos.crearVenta({ metodoPago: 'mixto', pagos: { efectivo: 200, tarjeta: 250, transferencia: 50 }, items: [producto()] } as any, 'caj-1');
    expect([creadas[0].montoEfectivo, creadas[0].montoTarjeta, creadas[0].montoTransferencia].map(Number)).toEqual([200, 250, 50]);
  });

  it('un pago que no es mixto no lleva desglose', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'efectivo', pagos: { efectivo: 500 }, items: [producto()] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Cobro de una cita con participantes y comisiones', () => {
  const citaLista = (extra: Partial<CitaMem> = {}): CitaMem => ({ id: 40, estado: 'completada', servicioId: 5, especialistaId: 'est-1', ventaItem: null, ...extra });

  it('liga la cita y la especialista, y registra a las participantes con su comisión', async () => {
    const { pos, creadas } = montar({ citas: [citaLista()], comision: { servicioId: 5, monto: 100, activo: true }, recibe: ['aux-1'] });
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1, participantes: ['aux-1'] }] } as any, 'caj-1');
    const item = creadas[0].items.create[0];
    expect(item).toMatchObject({ citaId: 40, especialistaId: 'est-1', servicioId: 5 });
    const participantes = item.participantes.create.map((p: any) => [p.usuarioId, Number(p.comisionMonto)]);
    // La especialista de la cita siempre participa; solo quien recibe comisiones gana el monto.
    expect(participantes).toEqual(expect.arrayContaining([['est-1', 0], ['aux-1', 100]]));
    expect(participantes).toHaveLength(2);
  });

  it('sin comisión activa para el servicio, nadie gana comisión', async () => {
    const { pos, creadas } = montar({ citas: [citaLista()], comision: { servicioId: 5, monto: 100, activo: false }, recibe: ['aux-1'] });
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1, participantes: ['aux-1'] }] } as any, 'caj-1');
    expect(creadas[0].items.create[0].participantes.create.every((p: any) => Number(p.comisionMonto) === 0)).toBe(true);
  });

  it('la misma cita no se cobra dos veces: 409', async () => {
    const { pos } = montar({ citas: [citaLista({ ventaItem: { id: 1 } })] });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('si dos cobros se cruzan, el índice único de cita_id responde 409', async () => {
    const choque = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['cita_id'] } });
    const { pos } = montar({ citas: [citaLista()], errorAlCrear: choque });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('otra violación de unicidad (no de cita_id) no se reporta como cita cobrada', async () => {
    const otro = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['folio'] } });
    const { pos } = montar({ citas: [citaLista()], errorAlCrear: otro });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBe(otro);
  });

  it('si la especialista de la cita ya se dio de baja, la cita se cobra igual', async () => {
    const { pos, creadas } = montar({ citas: [citaLista({ especialistaId: 'est-baja' })] });
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1');
    expect(creadas[0].items.create[0].participantes.create.map((p: any) => p.usuarioId)).toEqual(['est-baja']);
  });

  it('la misma cita dos veces en un ticket responde 409', async () => {
    const { pos } = montar({ citas: [citaLista()] });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }, { servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('una cita que no se ha finalizado no se cobra: 400', async () => {
    const { pos } = montar({ citas: [citaLista({ estado: 'en_curso' })] });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1 }] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una participante que no es del personal responde 400', async () => {
    const { pos } = montar({ citas: [citaLista()] });
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, citaId: 40, cantidad: 1, participantes: ['cli-9'] }] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un servicio sin cita también registra participantes y comisión', async () => {
    const { pos, creadas } = montar({ comision: { servicioId: 5, monto: 100, activo: true }, recibe: ['aux-1'] });
    await pos.crearVenta({ metodoPago: 'efectivo', items: [{ servicioId: 5, cantidad: 2, participantes: ['aux-1'] }] } as any, 'caj-1');
    const item = creadas[0].items.create[0];
    expect(item.citaId ?? null).toBeNull();
    expect(item.participantes.create.map((p: any) => [p.usuarioId, Number(p.comisionMonto)])).toEqual([['aux-1', 200]]);
  });

  it('un producto no lleva participantes: 400', async () => {
    const { pos } = montar();
    await expect(pos.crearVenta({ metodoPago: 'efectivo', items: [producto({ participantes: ['aux-1'] })] } as any, 'caj-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DTO de venta', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it('acepta citaId, participantes, motivoDescuento y pagos mixtos', async () => {
    const dto = await pipe.transform(
      { metodoPago: 'mixto', motivoDescuento: 'x', descuento: 0, pagos: { efectivo: '100', tarjeta: 50 }, items: [{ servicioId: 5, citaId: '40', cantidad: 1, participantes: ['11111111-1111-4111-8111-111111111111'] }] },
      { type: 'body', metatype: CreateVentaDto },
    );
    expect(dto.items[0].citaId).toBe(40);
    expect(dto.pagos?.efectivo).toBe(100);
  });
});

describe('Cancelar una venta libera sus citas', () => {
  it('quita el cita_id de las líneas para que la cita vuelva a quedar por cobrar', async () => {
    const tx: any = {
      ventaLocal: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => ({ id: 7, estado: 'cancelada' })) },
      ventaLocalItem: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = {
      ventaLocal: { findUnique: jest.fn(async () => ({ id: 7, estado: 'pagada', items: [{ id: 1, presentacionId: null, servicioId: 5, cantidad: 1, citaId: 40 }] })) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const pos = new PosService(prisma, { registrarEntrada: jest.fn() } as any, { emit: jest.fn() } as any);
    await pos.cancelarVenta(7, { motivoCancelacion: 'Método equivocado' } as any, 'caj-1');
    expect(tx.ventaLocalItem.updateMany).toHaveBeenCalledWith({ where: { ventaId: 7, citaId: { not: null } }, data: { citaId: null } });
  });
});
