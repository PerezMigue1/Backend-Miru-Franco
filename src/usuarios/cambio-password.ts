import * as crypto from 'crypto';
import { ZONA_NEGOCIO } from '../common/utils/zona-mexico';

/**
 * Código por correo para cambiar la contraseña desde el perfil (POST /auth/me/password/codigo y
 * POST /auth/me/password). Reusa las columnas codigoOTP/otpExpira, que la activación solo usa en
 * cuentas sin confirmar: aquí solo se escriben en cuentas confirmadas, con el prefijo "cp1:" para que
 * nunca coincidan con un código de activación (6 dígitos en claro).
 *
 * codigoOTP = "cp1:<intentos fallidos>:<códigos pedidos en la hora>:<inicio de esa hora, epoch s>:<HMAC hex>"
 * y otpExpira = vencimiento del código. El HMAC (de id:código) usa una llave derivada de JWT_SECRET: con
 * solo leer la base no se puede probar el millón de códigos posibles. El código en claro nunca se
 * guarda, no se devuelve y no se registra.
 *
 * Tope por cuenta (no por IP): cada código admite MAX_INTENTOS_CODIGO fallos y se pueden pedir
 * MAX_CODIGOS_POR_HORA por hora; un código agotado se conserva (inservible) para que pedir otro no
 * reinicie la cuenta. Así son 25 intentos por hora como máximo, vengan de donde vengan.
 */
export const VIGENCIA_CODIGO_MINUTOS = 10;
export const MAX_INTENTOS_CODIGO = 5;
export const MAX_CODIGOS_POR_HORA = 5;
const HORA_SEGUNDOS = 60 * 60;
const PREFIJO = 'cp1';

export interface CodigoGuardado {
  intentos: number;
  pedidos: number;
  /** Inicio de la hora en que se cuentan los códigos pedidos, en segundos epoch. */
  ventanaDesde: number;
  hash: string;
}

export function generarCodigo(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export const esCodigoConFormato = (codigo: unknown): codigo is string => typeof codigo === 'string' && /^\d{6}$/.test(codigo);

export function hashCodigo(secreto: string, usuarioId: string, codigo: string): string {
  const llave = crypto.createHmac('sha256', secreto).update('cambio-password:v1').digest();
  return crypto.createHmac('sha256', llave).update(`${usuarioId}:${codigo}`).digest('hex');
}

export const guardarCodigo = (c: CodigoGuardado) => `${PREFIJO}:${c.intentos}:${c.pedidos}:${c.ventanaDesde}:${c.hash}`;

/** El valor de codigoOTP es de este flujo (y no un código de activación). */
export const esCodigoDeCambio = (valor: unknown) => typeof valor === 'string' && valor.startsWith(`${PREFIJO}:`);

/** null si el campo está vacío o es otra cosa (p. ej. un código de activación). */
export function leerCodigo(valor: string | null | undefined): CodigoGuardado | null {
  const m = typeof valor === 'string' ? /^cp1:(\d+):(\d+):(\d+):([0-9a-f]{64})$/.exec(valor) : null;
  return m ? { intentos: Number(m[1]), pedidos: Number(m[2]), ventanaDesde: Number(m[3]), hash: m[4] } : null;
}

/**
 * Cuenta del código que se va a pedir: sigue la hora en curso del código anterior o abre una nueva.
 * `{ minutosRestantes }` si ya se pidieron MAX_CODIGOS_POR_HORA en esta hora.
 */
export function cuentaDeCodigos(
  anterior: CodigoGuardado | null,
  ahoraMs: number,
): { pedidos: number; ventanaDesde: number } | { minutosRestantes: number } {
  const ahora = Math.floor(ahoraMs / 1000);
  if (anterior && ahora - anterior.ventanaDesde < HORA_SEGUNDOS) {
    if (anterior.pedidos >= MAX_CODIGOS_POR_HORA) {
      return { minutosRestantes: Math.max(1, Math.ceil((anterior.ventanaDesde + HORA_SEGUNDOS - ahora) / 60)) };
    }
    return { pedidos: anterior.pedidos + 1, ventanaDesde: anterior.ventanaDesde };
  }
  return { pedidos: 1, ventanaDesde: ahora };
}

/** Comparación en tiempo constante (los dos hashes miden 32 bytes). */
export function hashesIguales(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/** "7 de octubre de 2026, 10:15" en hora del centro de México. */
export function fechaHoraMexico(fecha: Date): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_NEGOCIO, dateStyle: 'long', timeStyle: 'short' }).format(fecha);
}
