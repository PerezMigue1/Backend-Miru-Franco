import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Límites de POST /auth/movil/renovar (los aplica SesionesMovilesService.renovar):
 * - por sesión (familia), 10 por minuto, contado solo cuando el token existe;
 * - por IP, 120 por minuto, contado solo con tokens que no existen.
 * No hay límite general por IP: detrás del proxy de Render `req.ip` puede ser la misma para todas las
 * clientas (no hay `trust proxy`) y un tercero podría agotarlo con basura. Así la basura nunca bloquea
 * una renovación válida ni crea claves por token.
 */
export const RENOVACIONES_POR_SESION = 10;
export const TOKENS_INEXISTENTES_POR_IP = 120;
const VENTANA_MS = 60_000;
const LIMPIEZA_CADA_MS = 10_000;

/** Contador en memoria por ventana fija de 1 minuto (por instancia, como RateLimitGuard). */
export class ContadorPorVentana {
  private readonly conteos = new Map<string, { n: number; vence: number }>();
  private ultimaLimpieza = 0;

  constructor(private readonly maximo: number) {}

  /** Suma uno; lanza 429 si la clave ya llegó al máximo en su ventana. */
  contar(clave: string, ahora = Date.now()): void {
    // Borra ventanas vencidas como mucho cada 10 s (no recorre el mapa en cada petición).
    if (ahora - this.ultimaLimpieza > LIMPIEZA_CADA_MS) {
      this.ultimaLimpieza = ahora;
      for (const [k, v] of this.conteos) if (v.vence <= ahora) this.conteos.delete(k);
    }
    const actual = this.conteos.get(clave);
    if (!actual || actual.vence <= ahora) {
      this.conteos.set(clave, { n: 1, vence: ahora + VENTANA_MS });
      return;
    }
    if (actual.n >= this.maximo) {
      const retryAfter = Math.ceil((actual.vence - ahora) / 1000);
      throw new HttpException(
        { success: false, message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfter} segundos.`, retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    actual.n++;
  }
}
