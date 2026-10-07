import * as crypto from 'crypto';
import { sanitizeInput } from '../common/utils/security.util';

/**
 * Sesión de la app móvil de clientas (canal "movil"). El login o el canje de Google con canal "movil",
 * en modo Bearer y con rol cliente, entregan un token de acceso de 15 min (claims canal y sid) y un
 * token de renovación. POST /auth/movil/renovar rota el de renovación en cada uso; la sesión vence a
 * los 30 días sin uso. La web (cookie) y el personal siguen con la sesión de siempre.
 */
export const CANAL_MOVIL = 'movil';
export const DIAS_SESION_MOVIL = 30;
/** Reuso de un token recién rotado: dentro de este plazo se asume carrera de la misma app (409). */
export const GRACIA_REUSO_MS = 30_000;
/** La limpieza diaria borra filas vencidas o revocadas hace más de estos días. */
export const DIAS_CONSERVAR_SESION = 7;
export const MAX_DISPOSITIVO = 80;
const DIA_MS = 24 * 60 * 60_000;

/** 32 bytes aleatorios en base64url (43 caracteres). Solo se entrega a la app; en la base va su hash. */
export const generarRefreshToken = () => crypto.randomBytes(32).toString('base64url');

/** SHA-256 hex. Basta un hash rápido: el token es aleatorio de 256 bits, no una contraseña. */
export const hashRefreshToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const vencimientoSesion = (desde: Date) => new Date(desde.getTime() + DIAS_SESION_MOVIL * DIA_MS);

export const esTokenMovil = (payload: unknown) =>
  typeof payload === 'object' && payload !== null && (payload as { canal?: unknown }).canal === CANAL_MOVIL;

/** Texto libre del dispositivo: sin caracteres de control ni de marcado, máximo 80 caracteres. */
export function limpiarDispositivo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpio = sanitizeInput(valor).replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim().slice(0, MAX_DISPOSITIVO);
  return limpio || null;
}
