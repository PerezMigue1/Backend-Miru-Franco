import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ModeloClusteringService,
  ResultadoModeloClustering,
  VariablesClusteringCliente,
} from './modelo-clustering.service';

const MILISEGUNDOS_DIA = 86_400_000;
const ZONA_HORARIA = 'America/Mexico_City';
const ESTADOS_PEDIDO_VALIDOS = [
  'pagado',
  'preparando',
  'enviado',
  'entregado',
] as const;

interface ClienteBase {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
}

interface AcumuladoCliente {
  comprasOnline: number;
  comprasLocales: number;
  productosOnline: number;
  productosLocales: number;
  serviciosComprados: number;
  gastoOnline: number;
  gastoLocal: number;
  ultimaCompraOnline: Date | null;
  ultimaCompraLocal: Date | null;
}

export interface SegmentacionCliente extends ResultadoModeloClustering {
  clienteId: string;
  clienteNombre: string;
  clienteEmail: string;
  clienteActivo: boolean;
  calculadoEn: string;
  datosOrigen: {
    comprasOnline: number;
    comprasLocales: number;
    productosOnline: number;
    productosLocales: number;
    serviciosComprados: number;
    gastoOnline: number;
    gastoLocal: number;
    fechaUltimaCompraOnline: string | null;
    fechaUltimaCompraLocal: string | null;
  };
}

@Injectable()
export class SegmentacionClientesService {
  private readonly formatoFecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelo: ModeloClusteringService,
  ) {}

  async segmentarTodos(incluirInactivos = false) {
    const clientes = await this.prisma.usuario.findMany({
      where: {
        rol: 'cliente',
        ...(incluirInactivos ? {} : { activo: true }),
      },
      select: {
        id: true,
        nombre: true,
        email: true,
        activo: true,
      },
      orderBy: { nombre: 'asc' },
    });
    const data = await this.segmentarClientes(clientes);
    return {
      data,
      resumen: this.resumir(data),
      modelo: this.modelo.obtenerInformacionModelo(),
    };
  }

  async segmentarCliente(clienteId: string): Promise<SegmentacionCliente> {
    const cliente = await this.prisma.usuario.findFirst({
      where: { id: clienteId, rol: 'cliente' },
      select: {
        id: true,
        nombre: true,
        email: true,
        activo: true,
      },
    });
    if (!cliente) {
      throw new NotFoundException(`Cliente ${clienteId} no encontrado`);
    }
    const [resultado] = await this.segmentarClientes([cliente]);
    return resultado;
  }

  private async segmentarClientes(
    clientes: ClienteBase[],
  ): Promise<SegmentacionCliente[]> {
    if (clientes.length === 0) return [];
    const clienteIds = clientes.map((cliente) => cliente.id);

    const [pedidos, ventasLocales] = await Promise.all([
      this.prisma.pedido.findMany({
        where: {
          usuarioId: { in: clienteIds },
          estado: { in: [...ESTADOS_PEDIDO_VALIDOS] },
        },
        select: {
          usuarioId: true,
          total: true,
          creadoEn: true,
          items: { select: { cantidad: true } },
        },
      }),
      this.prisma.ventaLocal.findMany({
        where: {
          clienteId: { in: clienteIds },
          estado: 'pagada',
        },
        select: {
          clienteId: true,
          total: true,
          creadoEn: true,
          items: {
            select: {
              cantidad: true,
              presentacionId: true,
              servicioId: true,
            },
          },
        },
      }),
    ]);

    const acumulados = new Map<string, AcumuladoCliente>(
      clienteIds.map((id) => [id, this.acumuladoVacio()]),
    );

    for (const pedido of pedidos) {
      const acumulado = acumulados.get(pedido.usuarioId);
      if (!acumulado) continue;
      acumulado.comprasOnline += 1;
      acumulado.productosOnline += pedido.items.reduce(
        (total, item) => total + item.cantidad,
        0,
      );
      acumulado.gastoOnline += Number(pedido.total);
      acumulado.ultimaCompraOnline = this.fechaMasReciente(
        acumulado.ultimaCompraOnline,
        pedido.creadoEn,
      );
    }

    for (const venta of ventasLocales) {
      if (!venta.clienteId) continue;
      const acumulado = acumulados.get(venta.clienteId);
      if (!acumulado) continue;
      acumulado.comprasLocales += 1;
      acumulado.gastoLocal += Number(venta.total);
      acumulado.ultimaCompraLocal = this.fechaMasReciente(
        acumulado.ultimaCompraLocal,
        venta.creadoEn,
      );

      for (const item of venta.items) {
        const esProducto =
          item.presentacionId !== null && item.servicioId === null;
        const esServicio =
          item.presentacionId === null && item.servicioId !== null;
        if (esProducto) acumulado.productosLocales += item.cantidad;
        if (esServicio) acumulado.serviciosComprados += item.cantidad;
      }
    }

    const calculadoEn = new Date().toISOString();
    const fechaReferencia = new Date();
    return clientes.map((cliente) => {
      const acumulado =
        acumulados.get(cliente.id) ?? this.acumuladoVacio();
      const variables = this.construirVariables(acumulado, fechaReferencia);
      return {
        clienteId: cliente.id,
        clienteNombre: cliente.nombre,
        clienteEmail: cliente.email,
        clienteActivo: cliente.activo,
        calculadoEn,
        datosOrigen: {
          comprasOnline: acumulado.comprasOnline,
          comprasLocales: acumulado.comprasLocales,
          productosOnline: acumulado.productosOnline,
          productosLocales: acumulado.productosLocales,
          serviciosComprados: acumulado.serviciosComprados,
          gastoOnline: Number(acumulado.gastoOnline.toFixed(2)),
          gastoLocal: Number(acumulado.gastoLocal.toFixed(2)),
          fechaUltimaCompraOnline:
            acumulado.ultimaCompraOnline?.toISOString() ?? null,
          fechaUltimaCompraLocal:
            acumulado.ultimaCompraLocal?.toISOString() ?? null,
        },
        ...this.modelo.predecir(variables),
      };
    });
  }

  private construirVariables(
    acumulado: AcumuladoCliente,
    fechaReferencia: Date,
  ): VariablesClusteringCliente {
    const frecuenciaTotal =
      acumulado.comprasOnline + acumulado.comprasLocales;
    const productosTotales =
      acumulado.productosOnline + acumulado.productosLocales;
    const gastoTotal = acumulado.gastoOnline + acumulado.gastoLocal;
    const ultimaCompra = this.fechaMasReciente(
      acumulado.ultimaCompraOnline,
      acumulado.ultimaCompraLocal,
    );

    return {
      frecuencia_total: frecuenciaTotal,
      productos_totales: productosTotales,
      servicios_comprados: acumulado.serviciosComprados,
      gasto_total: Number(gastoTotal.toFixed(2)),
      ticket_promedio:
        frecuenciaTotal > 0
          ? Number((gastoTotal / frecuenciaTotal).toFixed(4))
          : 0,
      proporcion_online:
        gastoTotal > 0
          ? Number((acumulado.gastoOnline / gastoTotal).toFixed(6))
          : 0,
      recencia_dias: ultimaCompra
        ? this.diasCalendario(ultimaCompra, fechaReferencia)
        : this.modelo.obtenerRecenciaSinCompra(),
    };
  }

  private diasCalendario(desde: Date, hasta: Date): number {
    const ordinal = (fecha: Date) => {
      const [anio, mes, dia] = this.formatoFecha
        .format(fecha)
        .split('-')
        .map(Number);
      return Date.UTC(anio, mes - 1, dia);
    };
    return Math.max(
      0,
      Math.floor((ordinal(hasta) - ordinal(desde)) / MILISEGUNDOS_DIA),
    );
  }

  private fechaMasReciente(
    primera: Date | null,
    segunda: Date | null,
  ): Date | null {
    if (!primera) return segunda;
    if (!segunda) return primera;
    return primera > segunda ? primera : segunda;
  }

  private acumuladoVacio(): AcumuladoCliente {
    return {
      comprasOnline: 0,
      comprasLocales: 0,
      productosOnline: 0,
      productosLocales: 0,
      serviciosComprados: 0,
      gastoOnline: 0,
      gastoLocal: 0,
      ultimaCompraOnline: null,
      ultimaCompraLocal: null,
    };
  }

  private resumir(data: SegmentacionCliente[]) {
    return data.reduce<Record<string, number>>((resumen, cliente) => {
      resumen[cliente.segmento] = (resumen[cliente.segmento] ?? 0) + 1;
      return resumen;
    }, {});
  }
}
