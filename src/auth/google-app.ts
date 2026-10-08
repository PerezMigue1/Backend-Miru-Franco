import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { jwtSecretObligatorio } from './jwt-secret';
import { JWT_TTL_STATE_GOOGLE_SEGUNDOS } from './jwt-ttl';

/**
 * Google desde la app móvil (Expo). La app abre GET /api/auth/google?origen=app&code_challenge=<S256>
 * en el navegador del sistema; el guard viaja el challenge a Google dentro de un `state` firmado por
 * nosotros (la estrategia usa NullStore, así que passport no lo valida). En el callback, un state válido
 * marca el flujo como de app: el código OAuth se guarda junto al challenge y la redirección va siempre
 * al deep link fijo, con solo el código. Al canjearlo, la app presenta el code_verifier (PKCE, RFC 7636).
 * Sin state válido, el flujo web queda igual que siempre.
 */
export const DEEP_LINK_APP = 'appmirufranco://auth/callback';

const TIPO_STATE = 'google-oauth-state';
const ORIGEN_APP = 'app';

/** S256 en base64url sin relleno: SHA-256 → 32 bytes → exactamente 43 caracteres. */
export function esCodeChallenge(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** code_verifier según RFC 7636: 43 a 128 caracteres no reservados. */
export function esCodeVerifier(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

export function challengeDeVerifier(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/** En la base el código de la app va unido a su challenge; a la app solo se le entrega `codigo`. */
export const codigoGuardadoApp = (codigo: string, challenge: string) => `${codigo}.${challenge}`;

/**
 * Llave derivada del secreto de sesión, nunca el secreto mismo: si el state se firmara con JWT_SECRET,
 * cualquiera obtendría un JWT válido llamando a /api/auth/google?origen=app y podría usarlo como token
 * Bearer de sesión (JwtStrategy lo aceptaría con `id` indefinido).
 */
function llaveState(): string {
  return crypto
    .createHmac('sha256', jwtSecretObligatorio(process.env.JWT_SECRET))
    .update('google-oauth-state:v1')
    .digest('hex');
}

export function firmarStateApp(codeChallenge: string): string {
  const jwt = new JwtService({ secret: llaveState() });
  return jwt.sign({ tipo: TIPO_STATE, origen: ORIGEN_APP, cc: codeChallenge }, { expiresIn: JWT_TTL_STATE_GOOGLE_SEGUNDOS });
}

/** null si no hay state, si la firma no cuadra, si venció o si el contenido no es de la app. */
export function leerStateApp(state: unknown): { codeChallenge: string } | null {
  if (typeof state !== 'string') return null;
  try {
    const jwt = new JwtService({ secret: llaveState() });
    const payload: any = jwt.verify(state);
    if (payload?.tipo !== TIPO_STATE || payload?.origen !== ORIGEN_APP || !esCodeChallenge(payload?.cc)) {
      return null;
    }
    return { codeChallenge: payload.cc };
  } catch {
    return null;
  }
}
