import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Único lugar donde se decide qué orígenes pueden llamar a la API desde un navegador.
 *
 * - Producción: el dominio propio del frontend. La cookie de sesión `mf_session`
 *   (api.mirufranco.com, SameSite=Strict, ver src/auth/auth-cookie.ts) solo viaja desde este
 *   mismo "site", así que otros dominios no tendrían sesión aunque CORS los dejara pasar.
 * - Desarrollo (NODE_ENV distinto de production): además, el frontend local.
 * - Extra, por variable de entorno (nunca comodines):
 *   · FRONTEND_URL: la URL del frontend que ya usa el backend para enlaces de correo y OAuth.
 *   · CORS_ALLOWED_ORIGINS: lista separada por comas de orígenes exactos adicionales
 *     (p. ej. un dominio de preview de Vercel o el frontend en la red local para `dev:mobile`).
 * Un valor que no sea un origen http(s) válido (incluido `*`) se ignora.
 */
const ORIGENES_PRODUCCION = ['https://www.mirufranco.com', 'https://mirufranco.com'];

const ORIGENES_DESARROLLO = ['http://localhost:3000'];

const METODOS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

// X-Auth-Mode: el frontend web pide la sesión como cookie httpOnly (ver src/auth/auth-cookie.ts)
const CABECERAS_PERMITIDAS = ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Last-Event-ID', 'X-Auth-Mode'];

function normalizarOrigen(valor: string): string | null {
  try {
    const url = new URL(valor.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function construirOrigenesPermitidos(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const origenes = new Set<string>(ORIGENES_PRODUCCION);
  if (env.NODE_ENV !== 'production') {
    ORIGENES_DESARROLLO.forEach((o) => origenes.add(o));
  }
  const extra = [env.FRONTEND_URL ?? '', ...(env.CORS_ALLOWED_ORIGINS ?? '').split(',')];
  for (const valor of extra) {
    if (!valor.trim()) continue;
    const origen = normalizarOrigen(valor);
    if (origen) {
      origenes.add(origen);
    } else {
      console.warn(`⚠️ CORS: se ignora el origen configurado no válido: ${valor.trim()}`);
    }
  }
  return origenes;
}

export function crearCorsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  const permitidos = construirOrigenesPermitidos(env);
  return {
    origin: (origin, callback) => {
      // Sin cabecera Origin no es una petición CORS de navegador: servidor a servidor (SSR/ISR de
      // Next en Vercel, Alexa en /api/oauth/token), apps o curl. CORS no aplica a esas.
      if (!origin) return callback(null, true);
      if (permitidos.has(origin)) return callback(null, true);
      console.warn(`⚠️ CORS: Origen bloqueado: ${origin}`);
      // Sin cabeceras CORS: el navegador bloquea la respuesta (y el preflight) para ese origen.
      return callback(null, false);
    },
    credentials: true,
    methods: METODOS,
    allowedHeaders: CABECERAS_PERMITIDAS,
    exposedHeaders: ['Authorization'],
  };
}
