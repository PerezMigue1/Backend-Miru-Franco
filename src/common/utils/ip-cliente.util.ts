/**
 * IP de quien hace la petición, con la misma regla que RateLimitGuard (common/guards/rate-limit.guard.ts,
 * getKey), para que el límite de peticiones y la evidencia de los consentimientos hablen de la misma IP:
 *   1. req.ip de Express, que respeta la opción 'trust proxy'. Sin esa opción (main.ts hoy no la pone) es la
 *      dirección de quien abre la conexión con el servidor (en Render, su proxy) y x-forwarded-for no se usa;
 *      con 'trust proxy' configurado, Express la toma de x-forwarded-for según los saltos de confianza.
 *   2. Si no hay req.ip, la dirección del socket (req.connection.remoteAddress).
 *   3. Solo si tampoco hay, el primer valor de x-forwarded-for (lo puede escribir la clienta).
 * Devuelve null si no hay ninguna. Se recorta a 100 caracteres para guardarla.
 */
export interface PeticionConIp {
  ip?: string;
  headers?: Record<string, unknown>;
  connection?: { remoteAddress?: string };
}

export function ipDelCliente(req: PeticionConIp | undefined): string | null {
  const cabecera = req?.headers?.['x-forwarded-for'];
  const reenviada = typeof cabecera === 'string' ? cabecera.split(',')[0] : undefined;
  const ip = req?.ip || req?.connection?.remoteAddress || reenviada;
  return ip ? ip.slice(0, 100) : null;
}
