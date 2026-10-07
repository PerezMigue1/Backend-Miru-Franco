import { sanitizeInput } from '../common/utils/security.util';

/** Tope de texto de tratamientos (igual que productosUsados y alergias). */
export const MAX_TRATAMIENTOS = 1000;

/**
 * Regla única de tratamientos para el registro y el perfil:
 * - tratamientosQuimicos false: tratamientos queda en null;
 * - texto sin la bandera: la bandera pasa a true;
 * - null o vacío en tratamientos lo borra.
 * Devuelve solo los campos que cambian ({} si no llegó ninguno). El texto va sanitizado.
 */
export function normalizarTratamientos(
  bandera: unknown,
  texto: unknown,
): { tratamientosQuimicos?: boolean; tratamientos?: string | null } {
  const limpio = typeof texto === 'string' ? sanitizeInput(texto) : texto === null ? '' : undefined;
  if (bandera === false) return { tratamientosQuimicos: false, tratamientos: null };
  if (bandera === true) {
    return limpio === undefined ? { tratamientosQuimicos: true } : { tratamientosQuimicos: true, tratamientos: limpio || null };
  }
  if (limpio === undefined) return {};
  return limpio ? { tratamientosQuimicos: true, tratamientos: limpio } : { tratamientos: null };
}
