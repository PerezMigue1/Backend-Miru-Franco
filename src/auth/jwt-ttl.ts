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
