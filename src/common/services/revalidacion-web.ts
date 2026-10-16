import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Revalidación inmediata de la web: cuando el personal guarda algo que se ve en el sitio (configuración, reglas,
 * textos, galería, equipo, promociones, preguntas), el backend avisa a la web (POST {FRONTEND_URL}/api/revalidar con
 * el secreto compartido REVALIDAR_SECRETO) y la web vacía su caché de lo público. Si falta la variable o la web no
 * responde, no pasa nada: la caché de 60 segundos sigue de respaldo. Nunca bloquea ni hace fallar el guardado.
 */
const logger = new Logger('RevalidacionWeb');
/** Varios guardados seguidos (por ejemplo, reordenar fotos) se avisan una sola vez. */
const ESPERA_MS = 1000;
const TIEMPO_MAXIMO_MS = 5000;
let pendiente: ReturnType<typeof setTimeout> | null = null;

export function destinoRevalidacion(): { url: string; secreto: string } | null {
  const base = (process.env.FRONTEND_URL ?? '').trim().replace(/\/+$/, '');
  const secreto = (process.env.REVALIDAR_SECRETO ?? '').trim();
  // Un secreto corto no protege el endpoint: sin uno de al menos 32 caracteres no se avisa.
  if (!base || secreto.length < 32) return null;
  return { url: `${base}/api/revalidar`, secreto };
}

export async function revalidarWebAhora(f: typeof fetch = fetch): Promise<boolean> {
  const destino = destinoRevalidacion();
  if (!destino) return false;
  try {
    const r = await f(destino.url, {
      method: 'POST',
      headers: { 'x-revalidar-secreto': destino.secreto },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!r.ok) logger.warn(`La web respondió ${r.status} al pedir la revalidación; queda la caché de 60 s`);
    return r.ok;
  } catch (e) {
    logger.warn(`No se pudo pedir la revalidación de la web (${e instanceof Error ? e.message : 'error'}); queda la caché de 60 s`);
    return false;
  }
}

/** Programa el aviso (sin esperar): lo llama el interceptor después de un guardado correcto. */
export function avisarRevalidacionWeb(): void {
  if (!destinoRevalidacion()) return;
  if (pendiente) clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    pendiente = null;
    void revalidarWebAhora();
  }, ESPERA_MS);
  pendiente.unref?.();
}

/** En los controladores de contenido público: después de cada POST, PUT, PATCH o DELETE correcto, avisa a la web. */
@Injectable()
export class RevalidarWebInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metodo = contexto.switchToHttp().getRequest<{ method?: string }>()?.method ?? 'GET';
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return next.handle();
    return next.handle().pipe(tap(() => avisarRevalidacionWeb()));
  }
}
