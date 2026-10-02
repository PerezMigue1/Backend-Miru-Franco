/**
 * Vigencia única del JWT de sesión: 24 horas, para los tres flujos que lo emiten.
 * - Login con correo: UsuariosService.login
 * - Google OAuth y refresh: AuthService.generateToken
 * También la anuncia OauthService (Alexa) como `expires_in`.
 *
 * Antes el login firmaba 1 día y refresh/Google 7 días. La diferencia venía de que AuthModule y
 * UsuariosModule registraban JwtModule con valores distintos; no era una decisión de diseño (no
 * existe "recordarme"). Mientras hay actividad, el frontend renueva el token y el backend corta
 * la sesión tras 15 min sin actividad, así que un usuario activo no nota esta vigencia; solo
 * acota cuánto sirve un token robado. La cookie `mf_session` toma su maxAge del `exp`
 * (src/auth/auth-cookie.ts).
 */
export const JWT_TTL_SEGUNDOS = 24 * 60 * 60;

/**
 * Un token solo se puede renovar (POST /auth/refresh) durante sus primeros 15 min, contados desde
 * su `lastActivity` (= emisión). Pasado ese plazo sigue sirviendo hasta su `exp` mientras la BD no
 * marque inactividad, pero ya no se renueva: un token con más de 15 min no se estira más allá de su `exp`.
 * `entregarSesion` le dice al frontend cuánto le queda para renovar (`renovarEnSegundos`).
 */
export const VENTANA_REFRESH_SEGUNDOS = 15 * 60;
