import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** Lo que usamos de un pago de Mercado Pago (GET /v1/payments/{id}). */
export interface PagoMercadoPago {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference: string | null;
  date_approved: string | null;
}

const API = 'https://api.mercadopago.com';
const TIEMPO_MAXIMO_MS = 10_000;

/**
 * Cliente mínimo de la API REST de Mercado Pago (sin SDK). El token sale de MP_ACCESS_TOKEN en cada
 * llamada y nunca se registra; ante un error solo se registra el código HTTP, nunca el cuerpo.
 */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name);

  private async llamar<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown, claveIdempotencia?: string): Promise<T> {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      this.logger.error('MP_ACCESS_TOKEN no está configurado');
      throw new ServiceUnavailableException('El pago en línea no está disponible por ahora.');
    }
    let res: Response;
    try {
      res = await fetch(`${API}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(claveIdempotencia ? { 'X-Idempotency-Key': claveIdempotencia } : {}),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
    } catch {
      this.logger.error(`Mercado Pago no respondió (${metodo} ${ruta.split('?')[0]})`);
      throw new ServiceUnavailableException('El pago en línea no está disponible por ahora.');
    }
    if (!res.ok) {
      this.logger.error(`Mercado Pago respondió ${res.status} (${metodo} ${ruta.split('?')[0]})`);
      throw new ServiceUnavailableException('El pago en línea no está disponible por ahora.');
    }
    return (await res.json()) as T;
  }

  crearPreferencia(cuerpo: Record<string, unknown>, claveIdempotencia: string) {
    return this.llamar<{ id: string; init_point: string }>('POST', '/checkout/preferences', cuerpo, claveIdempotencia);
  }

  obtenerPago(id: string) {
    return this.llamar<PagoMercadoPago>('GET', `/v1/payments/${encodeURIComponent(id)}`);
  }

  /** El intento de pago más reciente de un pedido (external_reference = id del pedido). */
  async buscarUltimoPago(referencia: string): Promise<PagoMercadoPago | null> {
    const q = new URLSearchParams({ external_reference: referencia, sort: 'date_created', criteria: 'desc', limit: '1' });
    const res = await this.llamar<{ results?: PagoMercadoPago[] }>('GET', `/v1/payments/search?${q}`);
    return res.results?.[0] ?? null;
  }
}
