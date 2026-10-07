import { Injectable, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException, BadGatewayException, HttpException, HttpStatus, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SecurityService } from '../common/services/security.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { JWT_TTL_SEGUNDOS } from '../auth/jwt-ttl';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarOtpDto } from './dto/verificar-otp.dto';
import { ReenviarCodigoDto } from './dto/reenviar-codigo.dto';
import { sanitizeInput, containsSQLInjection, sanitizeRegisterData, sanitizeEmail, sanitizePhone, normalizePhone, buildPhoneLookupCandidates, formaEscapadaAnterior } from '../common/utils/security.util';
import { validatePasswordAgainstPersonalData } from '../common/validators/password.validator';
import twilio from 'twilio';
import { sinConsentimiento } from './dto/consentimiento-datos-sensibles';
import { esFotoPerfilPermitida } from '../common/utils/foto-perfil.util';
import { jwtSecretObligatorio } from '../auth/jwt-secret';
import {
  MAX_INTENTOS_CODIGO,
  VIGENCIA_CODIGO_MINUTOS,
  cuentaDeCodigos,
  esCodigoConFormato,
  esCodigoDeCambio,
  fechaHoraMexico,
  generarCodigo,
  guardarCodigo,
  hashCodigo,
  hashesIguales,
  leerCodigo,
} from './cambio-password';
import { MAX_TRATAMIENTOS, normalizarTratamientos } from './tratamientos';

/**
 * Select seguro y único para cualquier respuesta que exponga un Usuario al cliente.
 * NUNCA incluir: password, codigoOTP, otpExpira, respuestaSeguridad, preguntaSeguridad,
 * resetPasswordToken, resetPasswordExpires, tokensRevocadosDesde, intentosLoginFallidos,
 * cuentaBloqueadaHasta, ultimoIntentoLogin.
 * `googleId` se conserva (no es secreto: es el id de cuenta de Google, no un token).
 */
const SELECT_USUARIO_SEGURO = {
  id: true,
  nombre: true,
  email: true,
  telefono: true,
  fechaNacimiento: true,
  rol: true,
  tipoCabello: true,
  colorNatural: true,
  colorActual: true,
  productosUsados: true,
  alergias: true,
  tratamientosQuimicos: true,
  tratamientos: true,
  googleId: true,
  foto: true,
  aceptaAvisoPrivacidad: true,
  recibePromociones: true,
  confirmado: true,
  creadoEn: true,
  actualizadoEn: true,
  activo: true,
} as const;

/**
 * Mensajes de la recuperación por pregunta de seguridad: los mismos (y el mismo 400) exista o no la
 * cuenta, tenga o no pregunta, sea o no de Google, para no revelar datos de la cuenta.
 */
export const SIN_PREGUNTA_RECUPERACION =
  'No pudimos continuar con la recuperación por pregunta de seguridad. Intenta recuperar tu cuenta por correo.';
export const DATOS_NO_COINCIDEN = 'Los datos no coinciden.';

@Injectable()
export class UsuariosService {
  // Logs sin datos personales (Render los guarda): solo ids, nunca correo, teléfono ni nombre.
  private readonly logger = new Logger(UsuariosService.name);
  private readonly twilioClient: ReturnType<typeof twilio> | null;
  private readonly twilioVerifyServiceSid: string | undefined;

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private jwtService: JwtService,
    private securityService: SecurityService,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioVerifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    this.twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;
  }

  private toTwilioE164(phone: string): string {
    const normalized = normalizePhone(phone);
    const digits = normalized.replace(/\D/g, '');

    if (normalized.startsWith('+')) {
      return normalized;
    }

    // Si viene en formato local MX (10 dígitos), prepender +52 para pruebas.
    if (digits.length === 10) {
      return `+52${digits}`;
    }

    // Si ya viene con 52 (12 dígitos) pero sin +, agregar +.
    if (digits.length === 12 && digits.startsWith('52')) {
      return `+${digits}`;
    }

    return digits ? `+${digits}` : '';
  }

  /**
   * POST /usuarios/registro. `permitirConfirmado` lo pone el controlador solo si quien registra tiene
   * sesión de admin; en el registro público `confirmado` se ignora (la cuenta se activa con el OTP).
   */
  async crearUsuario(createUsuarioDto: CreateUsuarioDto, opciones: { permitirConfirmado?: boolean } = {}) {
    // ⚠️ IMPORTANTE: Sanitizar TODOS los datos recibidos antes de procesarlos
    // Esto previene XSS incluso si alguien envía peticiones directas (bypass del frontend)
    const sanitizedData = sanitizeRegisterData(createUsuarioDto);
    
    const { nombre, email, telefono, password, fechaNacimiento, preguntaSeguridad, perfilCapilar, aceptaAvisoPrivacidad, recibePromociones } = sanitizedData;

    // Prevenir SQL injection
    if (
      containsSQLInjection(nombre) ||
      containsSQLInjection(email) ||
      (telefono && containsSQLInjection(telefono)) ||
      (preguntaSeguridad?.pregunta && containsSQLInjection(preguntaSeguridad.pregunta)) ||
      (preguntaSeguridad?.respuesta && containsSQLInjection(preguntaSeguridad.respuesta))
    ) {
      this.logger.warn('Intento de SQL injection detectado en crearUsuario');
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    // Verificar si el email ya existe
    const existe = await this.prisma.usuario.findUnique({
      where: { email },
    });

    if (existe) {
      throw new ConflictException('El email ya está registrado');
    }

    // Validar que la contraseña no contenga datos personales
    const passwordValidation = validatePasswordAgainstPersonalData(password, {
      nombre,
      email,
      telefono,
      fechaNacimiento,
      preguntaSeguridad,
    });

    if (!passwordValidation.valid) {
      throw new BadRequestException(passwordValidation.reason);
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Hashear la respuesta de seguridad
    const respuestaHasheada = await bcrypt.hash((preguntaSeguridad?.respuesta || '').trim(), 10);

    // Tratamientos tal como los manda la app y la web (bandera y texto); misma regla que el perfil.
    const tratamientos = normalizarTratamientos(
      createUsuarioDto.perfilCapilar?.tratamientosQuimicos,
      createUsuarioDto.perfilCapilar?.tratamientos,
    );

    // Generar código OTP de 6 dígitos
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos

    // Crear nuevo usuario con campos embebidos
    // ⚠️ IMPORTANTE: Usar sanitizedData, NO createUsuarioDto directamente
    const nuevoUsuario = await this.prisma.usuario.create({
      data: {
        nombre,              // ✅ Ya sanitizado
        email,               // ✅ Ya sanitizado
        telefono,            // ✅ Ya sanitizado
        password: hashedPassword,
        fechaNacimiento: new Date(fechaNacimiento),
        // Pregunta de seguridad embebida
        preguntaSeguridad: preguntaSeguridad?.pregunta || '', // ✅ Ya sanitizado
        respuestaSeguridad: respuestaHasheada,
        // Campos de perfil capilar embebidos
        tipoCabello: perfilCapilar?.tipoCabello as any,
        colorNatural: perfilCapilar?.colorNatural,      // ✅ Ya sanitizado
        colorActual: perfilCapilar?.colorActual,        // ✅ Ya sanitizado
        productosUsados: perfilCapilar?.productosUsados, // ✅ Ya sanitizado
        alergias: perfilCapilar?.alergias,              // ✅ Ya sanitizado
        tratamientosQuimicos: tratamientos.tratamientosQuimicos ?? false,
        tratamientos: tratamientos.tratamientos ?? null, // ✅ Sanitizado en normalizarTratamientos
        aceptaAvisoPrivacidad,
        recibePromociones: recibePromociones || false,
        codigoOTP,
        otpExpira,
        confirmado: opciones.permitirConfirmado ? (createUsuarioDto.confirmado ?? false) : false,
        activo: true,
      },
    });

    // Log seguro (sin datos sensibles)
    this.logger.log(`Usuario registrado: ${nuevoUsuario.id}`);

    const usuarioCreado = {
      id: nuevoUsuario.id,
      nombre: nuevoUsuario.nombre,
      email: nuevoUsuario.email,
      rol: nuevoUsuario.rol,
      activo: nuevoUsuario.activo,
    };

    // Enviar correo con el código OTP
    try {
      await this.emailService.sendOTPEmail(email, codigoOTP);
      return {
        success: true,
        message: 'Ingresa el código para activar tu cuenta. El código expira en 2 minutos.',
        requiereVerificacion: true,
        usuario: usuarioCreado,
      };
    } catch (err) {
      console.error('Error al enviar correo de activación:', err);
      return {
        success: true,
        message: 'Usuario registrado. No se pudo enviar el correo de activación.',
        requiereVerificacion: true,
        usuario: usuarioCreado,
      };
    }
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Sanitizar y validar entrada
    const emailSanitizado = sanitizeEmail(email);
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado) || containsSQLInjection(password)) {
      this.logger.warn('Intento de SQL injection detectado en login');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar si la cuenta está bloqueada
    const lockStatus = await this.securityService.isAccountLocked(emailSanitizado);
    if (lockStatus.locked) {
      const minutosRestantes = Math.ceil(
        (lockStatus.until!.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en ${minutosRestantes} minutos.`,
      );
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
    });

    // No revelar si el usuario existe o no (security best practice)
    if (!usuario || !usuario.activo || !usuario.password) {
      // Registrar intento fallido incluso si el usuario no existe (timing attack prevention)
      await this.securityService.recordFailedLoginAttempt(emailSanitizado);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const esValido = await bcrypt.compare(password, usuario.password);
    if (!esValido) {
      // Registrar intento fallido
      await this.securityService.recordFailedLoginAttempt(emailSanitizado);
      
      // Verificar si ahora está bloqueado
      const newLockStatus = await this.securityService.isAccountLocked(emailSanitizado);
      if (newLockStatus.locked) {
        throw new ForbiddenException(
          'Cuenta bloqueada temporalmente por múltiples intentos fallidos.',
        );
      }
      
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Verificar que la cuenta esté confirmada (excepto para usuarios de Google)
    if (!usuario.confirmado && !usuario.googleId) {
      throw new ForbiddenException('Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.');
    }

    // Resetear intentos fallidos después de login exitoso
    await this.securityService.resetFailedLoginAttempts(emailSanitizado);

    // Actualizar última actividad en la base de datos
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        ultimaActividad: new Date(),
      },
    });

    // Generar token JWT con información de actividad
    const now = Math.floor(Date.now() / 1000);
    const token = this.jwtService.sign(
      { 
        id: usuario.id, 
        email: usuario.email,
        jti: crypto.randomBytes(16).toString('hex'), // Token ID único
        iat: now, // Issued at time (para logout global)
        lastActivity: now,
      },
      { expiresIn: JWT_TTL_SEGUNDOS }, // misma vigencia que Google y refresh (src/auth/jwt-ttl.ts)
    );

    // Log seguro (sin contraseña)
    this.logger.log(`Login ok: ${usuario.id}`);

    return {
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
    };
  }

  async verificarOTP(verificarOtpDto: VerificarOtpDto) {
    const { email, codigo } = verificarOtpDto;

    // Sanitizar email antes de buscar
    const emailSanitizado = sanitizeEmail(email);

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    // Un código de cambio de contraseña (cuentas confirmadas, ver cambio-password.ts) no es de activación:
    // se responde igual que sin código para no revelar que alguien pidió uno.
    if (!usuario.codigoOTP || esCodigoDeCambio(usuario.codigoOTP)) {
      throw new BadRequestException('No hay código activo. Solicita uno nuevo.');
    }

    if (usuario.otpExpira && usuario.otpExpira < new Date()) {
      throw new BadRequestException('Código expirado. El código OTP solo es válido por 2 minutos. Solicita uno nuevo.');
    }

    if (usuario.codigoOTP !== codigo) {
      throw new BadRequestException('Código incorrecto.');
    }

    // Código correcto: activar cuenta y limpiar código
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        codigoOTP: null,
        otpExpira: null,
        confirmado: true,
      },
    });

    return {
      success: true,
      message: 'Código verificado correctamente. Cuenta activada.',
    };
  }

  async reenviarCodigo(reenviarCodigoDto: ReenviarCodigoDto) {
    const { email } = reenviarCodigoDto;

    // Sanitizar email antes de buscar
    const emailSanitizado = sanitizeEmail(email);

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    if (usuario.confirmado) {
      throw new BadRequestException('Este correo electrónico ya está activado.');
    }

    // Generar nuevo código OTP
    const nuevoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000);

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        codigoOTP: nuevoCodigo,
        otpExpira,
      },
    });

    try {
      await this.emailService.sendOTPEmail(emailSanitizado, nuevoCodigo);
      return {
        success: true,
        message: 'Nuevo código enviado al correo. Recuerda que el código expira en 2 minutos.',
      };
    } catch (emailError) {
      console.error('Error enviando correo:', emailError);
      throw new Error('Error al enviar el correo. Por favor intenta más tarde.');
    }
  }

  async verificarCorreoExistente(correo: string) {
    // Sanitizar email antes de buscar
    const correoSanitizado = sanitizeEmail(correo);

    if (!correoSanitizado) {
      return { existe: false, message: 'Correo no proporcionado' };
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: correoSanitizado },
    });

    if (usuario) {
      return { existe: true, message: 'Este correo ya está registrado' };
    }

    return { existe: false, message: 'Correo disponible' };
  }

  /**
   * @param incluirInactivos Solo debe ser true desde el panel admin (ruta ya protegida
   * con @Roles('admin')). Sin el flag, comportamiento idéntico a antes: solo activos.
   */
  async obtenerUsuarios(q?: string, incluirInactivos = false) {
    const term = q?.trim();
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        ...(incluirInactivos ? {} : { activo: true }),
        ...(term
          ? {
              OR: [
                { nombre: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { telefono: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: SELECT_USUARIO_SEGURO,
    });

    return {
      success: true,
      count: usuarios.length,
      data: usuarios,
    };
  }

  async obtenerUsuarioPorId(id: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
      select: SELECT_USUARIO_SEGURO,
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      success: true,
      data: usuario,
    };
  }

  /**
   * Normaliza fechaNacimiento a Date para Prisma. Acepta "YYYY-MM-DD" (lo que envía
   * <input type="date">) o ISO-8601 completo. `null`/'' limpia el campo.
   * Lanza BadRequestException si el valor no es una fecha válida.
   */
  private normalizarFechaNacimiento(valor: unknown): Date | null {
    if (valor === null || valor === '') return null;
    const fecha = new Date(valor as string);
    if (isNaN(fecha.getTime())) {
      throw new BadRequestException('Fecha de nacimiento inválida');
    }
    return fecha;
  }

  /**
   * La foto que llega del cliente solo puede ser null/vacía, una imagen de la cuenta propia de
   * Cloudinary o la que el usuario ya tiene guardada (p. ej. la de Google). Si no, 400.
   */
  private async validarFotoDelCliente(id: string, foto: unknown): Promise<void> {
    if (typeof foto !== 'string' || foto.trim() === '') return;
    const actual = await this.prisma.usuario.findUnique({ where: { id }, select: { foto: true } });
    const permitida = esFotoPerfilPermitida(foto, {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      fotoActual: actual?.foto ?? null,
    });
    if (!permitida) {
      throw new BadRequestException('La foto no es válida: debe ser una imagen subida desde el sitio.');
    }
  }

  async actualizarUsuario(id: string, updateData: any) {
    await this.validarFotoDelCliente(id, updateData.foto);
    // El consentimiento de datos sensibles solo se valida en el DTO: no es una columna.
    const { email, password, tratamientosQuimicos, tratamientos, ...camposActualizables } = sinConsentimiento(updateData);
    // Misma regla y sanitización de tratamientos que el perfil.
    Object.assign(camposActualizables, normalizarTratamientos(tratamientosQuimicos, tratamientos));

    if (camposActualizables.fechaNacimiento !== undefined) {
      camposActualizables.fechaNacimiento = this.normalizarFechaNacimiento(
        camposActualizables.fechaNacimiento,
      );
    }

    const usuarioActualizado = await this.prisma.usuario.update({
      where: { id },
      data: camposActualizables,
      select: SELECT_USUARIO_SEGURO,
    });

    if (!usuarioActualizado) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      success: true,
      message: 'Usuario actualizado correctamente',
      data: usuarioActualizado,
    };
  }

  async eliminarUsuario(id: string) {
    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: { activo: false },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      success: true,
      message: 'Usuario eliminado correctamente',
    };
  }

  /**
   * Verifica que, excluyendo a `idExcluido`, siga quedando al menos un admin activo.
   * Se usa antes de degradar el rol de un admin o de desactivarlo, para no dejar
   * el sistema sin nadie que pueda gestionar roles.
   */
  private async assertNoDejaSinAdmins(idExcluido: string): Promise<void> {
    const adminsRestantes = await this.prisma.usuario.count({
      where: { rol: 'admin', activo: true, id: { not: idExcluido } },
    });
    if (adminsRestantes === 0) {
      throw new BadRequestException(
        'No se puede completar la acción: dejaría al sistema sin administradores activos',
      );
    }
  }

  /**
   * Cambiar estado activo/inactivo de un usuario (solo admin).
   * PATCH /usuarios/:id/estado con body { activo: true | false }
   */
  async cambiarEstadoUsuario(id: string, activo: boolean) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!activo && usuario.rol === 'admin' && usuario.activo) {
      await this.assertNoDejaSinAdmins(id);
    }

    await this.prisma.usuario.update({
      where: { id },
      data: { activo },
    });

    return {
      success: true,
      message: activo ? 'Usuario activado correctamente' : 'Usuario desactivado correctamente',
      data: { id, activo },
    };
  }

  /** Cambiar solo el rol de un usuario (solo admin). Valores: cliente | becario | empleado | estilista | admin. */
  async cambiarRolUsuario(id: string, rol: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (usuario.rol === 'admin' && rol !== 'admin') {
      await this.assertNoDejaSinAdmins(id);
    }

    await this.prisma.usuario.update({
      where: { id },
      data: { rol },
    });

    return {
      success: true,
      message: 'Rol actualizado correctamente',
      data: { id, rol },
    };
  }

  async enviarCodigoRecuperacionSMS(phone: string) {
    // Normalizar teléfono para buscar con el mismo formato almacenado en BD.
    const phoneLookupCandidates = buildPhoneLookupCandidates(phone);

    // No revelar si existe o no el usuario.
    if (phoneLookupCandidates.length === 0) {
      return {
        success: true,
        message: 'Se envió el código',
      };
    }

    const usuario = await this.prisma.usuario.findFirst({
      where: {
        OR: phoneLookupCandidates.map((telefono) => ({ telefono })),
      },
      select: {
        id: true,
        telefono: true,
        activo: true,
      },
    });

    // No revelar si el teléfono existe o no en el sistema.
    if (!usuario?.id || !usuario.activo) {
      return {
        success: true,
        message: 'Se envió el código',
      };
    }

    if (!this.twilioClient || !this.twilioVerifyServiceSid) {
      throw new InternalServerErrorException('Twilio Verify no está configurado en el servidor');
    }

    const phoneForTwilio = this.toTwilioE164(usuario.telefono || phone);

    try {
      await this.twilioClient.verify.v2
        .services(this.twilioVerifyServiceSid)
        .verifications.create({ to: phoneForTwilio, channel: 'sms' });
      this.logger.log(`OTP SMS enviado con Twilio Verify: ${usuario.id}`);
    } catch (error) {
      this.logger.error(`Error enviando OTP SMS con Twilio Verify (código ${(error as any)?.code ?? '-'}, estado ${(error as any)?.status ?? '-'})`);
      throw new BadRequestException('No se pudo enviar el código de verificación por SMS');
    }

    return {
      success: true,
      message: 'Se envió el código',
    };
  }

  async verificarCodigoRecuperacionSMS(phone: string, codigo: string) {
    const phoneLookupCandidates = buildPhoneLookupCandidates(phone);
    const codigoNormalizado = (codigo || '').trim();

    if (phoneLookupCandidates.length === 0 || !codigoNormalizado) {
      throw new BadRequestException('Código inválido o expirado');
    }

    if (!this.twilioClient || !this.twilioVerifyServiceSid) {
      throw new InternalServerErrorException('Twilio Verify no está configurado en el servidor');
    }

    const usuario = await this.prisma.usuario.findFirst({
      where: {
        OR: phoneLookupCandidates.map((telefono) => ({ telefono })),
        activo: true,
      },
      select: {
        id: true,
        email: true,
        telefono: true,
      },
    });

    // Respuesta genérica para no revelar existencia de cuenta.
    if (!usuario) {
      throw new BadRequestException('Código inválido o expirado');
    }

    try {
      const phoneForTwilio = this.toTwilioE164(usuario.telefono || phone);
      const verificationCheck = await this.twilioClient.verify.v2
        .services(this.twilioVerifyServiceSid)
        .verificationChecks.create({ to: phoneForTwilio, code: codigoNormalizado });

      if (verificationCheck.status !== 'approved') {
        throw new BadRequestException('Código inválido o expirado');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error verificando OTP SMS con Twilio Verify (código ${(error as any)?.code ?? '-'}, estado ${(error as any)?.status ?? '-'})`);
      throw new BadRequestException('Código inválido o expirado');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresInMinutes = parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '10');
    const resetPasswordExpires = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        resetPasswordToken: token,
        resetPasswordExpires,
      },
    });

    return {
      success: true,
      token,
      email: usuario.email,
    };
  }

  async solicitarEnlaceRecuperacion(email: string) {
    // Sanitizar entrada
    const emailSanitizado = sanitizeEmail(email);
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado)) {
      this.logger.warn('Intento de SQL injection en solicitarEnlaceRecuperacion');
      // No revelar si el email existe o no
      return {
        success: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación',
      };
    }
    
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
      select: {
        id: true,
        email: true,
        activo: true,
        googleId: true,
        nombre: true,
      },
    });

    // No revelar si el usuario existe o no (prevenir enumeración)
    // Siempre devolver el mismo tipo de respuesta independientemente
    if (!usuario || !usuario.activo) {
      // No logear email real para prevenir información en logs
      console.log('⚠️ Intento de recuperación para email no encontrado o inactivo');
      return {
        success: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación',
      };
    }

    // Si es un usuario de Google, no permitir recuperación por email
    if (usuario.googleId) {
      this.logger.log(`Intento de recuperación para usuario de Google: ${usuario.id}`);
      return {
        success: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación',
      };
    }

    // Generar token único y aleatorio
    const token = crypto.randomBytes(32).toString('hex');
    
    // Tiempo de expiración: 10 minutos (según guía)
    const expiresInMinutes = parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '10');
    const resetPasswordExpires = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Guardar token en la base de datos
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        resetPasswordToken: token,
        resetPasswordExpires,
      },
    });

    // Construir enlace de recuperación
    const frontendUrl = process.env.FRONTEND_URL || 'https://miru-franco.vercel.app';
    const resetLink = `${frontendUrl}/reset-password?token=${token}&email=${encodeURIComponent(usuario.email)}`;

    // Enviar email con el enlace
    try {
      await this.emailService.sendPasswordResetEmail(
        usuario.email,
        resetLink,
        expiresInMinutes,
      );
      
      this.logger.log(`Enlace de recuperación enviado: ${usuario.id}`);
      
      return {
        success: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación',
      };
    } catch (err) {
      console.error('Error al enviar correo de recuperación:', err);
      // No revelar el error al usuario por seguridad
      return {
        success: true,
        message: 'Si el email existe, se ha enviado un enlace de recuperación',
      };
    }
  }

  async obtenerPreguntaSeguridad(email: string) {
    // Sanitizar entrada
    const emailSanitizado = sanitizeEmail(email);
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado)) {
      this.logger.warn('Intento de SQL injection en obtenerPreguntaSeguridad');
      throw new BadRequestException(SIN_PREGUNTA_RECUPERACION);
    }
    
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
      select: {
        id: true,
        email: true,
        activo: true,
        googleId: true,
        preguntaSeguridad: true,
      },
    });

    // No revelar si el usuario existe o no (prevenir enumeración)
    // Siempre devolver el mismo tipo de respuesta independientemente
    if (!usuario || !usuario.activo) {
      // No logear email real para prevenir información en logs
      throw new BadRequestException(SIN_PREGUNTA_RECUPERACION);
    }

    // Si es un usuario de Google y no tiene pregunta de seguridad
    if (usuario.googleId && !usuario.preguntaSeguridad) {
      throw new BadRequestException(SIN_PREGUNTA_RECUPERACION);
    }

    if (!usuario.preguntaSeguridad) {
      throw new BadRequestException(SIN_PREGUNTA_RECUPERACION);
    }

    return {
      success: true,
      pregunta: usuario.preguntaSeguridad,
    };
  }

  async validarRespuestaSeguridad(email: string, respuesta: string) {
    // Sanitizar email y respuesta antes de procesar
    const emailSanitizado = sanitizeEmail(email);
    const respuestaSanitizada = sanitizeInput(respuesta);

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
      select: {
        id: true,
        email: true,
        respuestaSeguridad: true,
      },
    });

    if (!usuario) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
    }

    if (!usuario.respuestaSeguridad) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
    }

    // Las respuestas registradas antes guardaron el hash del texto escapado (&#x27;, &quot;…): si la
    // forma tal cual no coincide, se prueba esa.
    const anterior = formaEscapadaAnterior(respuesta);
    const respuestaValida =
      (await bcrypt.compare(respuestaSanitizada.trim(), usuario.respuestaSeguridad)) ||
      (anterior !== respuestaSanitizada.trim() && (await bcrypt.compare(anterior, usuario.respuestaSeguridad)));
    if (!respuestaValida) {
      throw new BadRequestException(DATOS_NO_COINCIDEN);
    }

    // Generar token temporal válido por 10 minutos
    const token = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        resetPasswordToken: token,
        resetPasswordExpires,
      },
    });

    return {
      success: true,
      token,
      email: usuario.email,
    };
  }

  async validarTokenRecuperacion(email: string, token: string) {
    // Sanitizar email antes de buscar
    const emailSanitizado = sanitizeEmail(email);

    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email: emailSanitizado,
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
        email: true,
        nombre: true,
      },
    });

    if (!usuario) {
      throw new BadRequestException('Token inválido, expirado o ya utilizado');
    }

    return {
      success: true,
      valid: true,
      message: 'Token válido',
      email: usuario.email,
      nombre: usuario.nombre,
    };
  }

  async cambiarPassword(email: string, token: string, nuevaPassword: string) {
    // Sanitizar email antes de buscar
    const emailSanitizado = sanitizeEmail(email);

    // Verificar que el token existe, no está expirado y no ha sido usado
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email: emailSanitizado,
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!usuario) {
      throw new BadRequestException('Token inválido, expirado o ya utilizado');
    }

    // Validar que la nueva contraseña no sea igual a la anterior
    if (usuario.password) {
      const esMismaContraseña = await bcrypt.compare(nuevaPassword, usuario.password);
      if (esMismaContraseña) {
        throw new BadRequestException('La nueva contraseña no puede ser igual a la contraseña anterior');
      }
    }

    // Validar complejidad de contraseña (el DTO ya valida con @IsStrongPassword, pero validamos datos personales aquí)
    const passwordValidation = validatePasswordAgainstPersonalData(nuevaPassword, {
      nombre: usuario.nombre,
      email: usuario.email,
      telefono: usuario.telefono,
      fechaNacimiento: usuario.fechaNacimiento?.toISOString().split('T')[0],
      preguntaSeguridad: {
        respuesta: '', // No tenemos acceso a la respuesta en texto plano, pero validamos otros campos
      },
    });

    if (!passwordValidation.valid) {
      throw new BadRequestException(passwordValidation.reason);
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);

    // Actualizar contraseña, marcar token como usado (null = usado) y verificar cuenta
    // Si el usuario puede acceder al email y cambiar la contraseña, verificamos automáticamente la cuenta
    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null, // Marcar como usado
        resetPasswordExpires: null, // Limpiar expiración
        confirmado: true, // Verificar cuenta automáticamente (tiene acceso al email)
        // Cierra todas las sesiones (mismo mecanismo que logoutAll): quien recupera la cuenta saca
        // a quien la estuviera usando, también de la app móvil (su renovación compara contra esta fecha).
        tokensRevocadosDesde: new Date(),
      },
    });
    try {
      await this.prisma.sesionMovil.updateMany({ where: { usuarioId: usuario.id, revocadaEn: null }, data: { revocadaEn: new Date() } });
    } catch {
      this.logger.warn(`No se pudieron marcar las sesiones móviles como revocadas (usuario ${usuario.id})`);
    }

    return {
      success: true,
      message: 'Contraseña actualizada correctamente. Tu cuenta ha sido verificada automáticamente.',
    };
  }

  /**
   * Comprueba la contraseña actual de la cuenta con sesión. Errores con `code` (el filtro global lo
   * devuelve): 400 y no 401, porque la app trata el 401 como sesión vencida.
   */
  private async validarPasswordActual(id: string, actualPassword: string) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (!usuario.password) {
      throw new ConflictException({ message: 'Tu cuenta entra con Google y no tiene contraseña.', code: 'CUENTA_SIN_PASSWORD' });
    }
    // codigoOTP/otpExpira son de la activación mientras la cuenta no está confirmada: no se pisan.
    if (!usuario.confirmado) {
      throw new ConflictException({ message: 'Activa tu cuenta antes de cambiar la contraseña.', code: 'CUENTA_NO_CONFIRMADA' });
    }
    if (!(await bcrypt.compare(actualPassword, usuario.password))) {
      throw new BadRequestException({ message: 'La contraseña actual no es correcta.', code: 'PASSWORD_ACTUAL_INCORRECTA' });
    }
    return { ...usuario, password: usuario.password };
  }

  /** POST /auth/me/password/codigo: envía al correo de la cuenta un código para cambiar la contraseña. */
  async solicitarCodigoCambioPassword(id: string, actualPassword: string) {
    const usuario = await this.validarPasswordActual(id, actualPassword);

    // Tope por cuenta: MAX_CODIGOS_POR_HORA en la hora en curso, aunque cambie la IP o la instancia.
    const cuenta = cuentaDeCodigos(leerCodigo(usuario.codigoOTP), Date.now());
    if ('minutosRestantes' in cuenta) {
      throw new HttpException(
        {
          message: `Pediste demasiados códigos. Intenta de nuevo en ${cuenta.minutosRestantes} minutos.`,
          code: 'DEMASIADOS_CODIGOS',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const codigo = generarCodigo();
    const hash = hashCodigo(jwtSecretObligatorio(process.env.JWT_SECRET), id, codigo);
    const guardado = guardarCodigo({ intentos: 0, ...cuenta, hash });
    // Un código nuevo reemplaza al anterior. Update condicional: dos pedidos a la vez no pueden
    // leer la misma cuenta y colar un código de más.
    const escritura = await this.prisma.usuario.updateMany({
      where: { id, codigoOTP: usuario.codigoOTP },
      data: { codigoOTP: guardado, otpExpira: new Date(Date.now() + VIGENCIA_CODIGO_MINUTOS * 60_000) },
    });
    if (escritura.count === 0) {
      throw new ConflictException({
        message: 'Ya estamos enviando un código a tu correo. Revísalo en un momento.',
        code: 'CODIGO_EN_CURSO',
      });
    }

    try {
      await this.emailService.sendCodigoCambioPasswordEmail(usuario.email, codigo, VIGENCIA_CODIGO_MINUTOS);
    } catch {
      // Sin correo el código no sirve: queda inservible (sin reiniciar la cuenta de la hora).
      await this.prisma.usuario.updateMany({
        where: { id, codigoOTP: guardado },
        data: { codigoOTP: guardarCodigo({ intentos: MAX_INTENTOS_CODIGO, ...cuenta, hash }) },
      });
      this.logger.warn(`No se pudo enviar el código de cambio de contraseña (usuario ${id})`);
      throw new BadGatewayException({
        message: 'No pudimos enviar el código a tu correo. Intenta de nuevo en unos minutos.',
        code: 'CORREO_NO_ENVIADO',
      });
    }

    return {
      success: true,
      message: `Te enviamos un código a tu correo. Vence en ${VIGENCIA_CODIGO_MINUTOS} minutos.`,
      vigenciaMinutos: VIGENCIA_CODIGO_MINUTOS,
    };
  }

  /**
   * POST /auth/me/password (y PUT /usuarios/:id/cambiar-password, solo la dueña): cambia la contraseña
   * con la actual y el código del correo. Al cambiarla cierra todas las sesiones y avisa por correo.
   */
  async cambiarPasswordConCodigo(id: string, actualPassword: string, nuevaPassword: string, codigo: string) {
    const usuario = await this.validarPasswordActual(id, actualPassword);

    // Reglas de la nueva antes de tocar el código: un error aquí no gasta intentos.
    const esMismaContraseña = await bcrypt.compare(nuevaPassword, usuario.password);
    if (esMismaContraseña) {
      throw new BadRequestException('La nueva contraseña no puede ser igual a la contraseña actual');
    }

    // Validar complejidad de contraseña (el DTO ya valida con @IsStrongPassword, pero validamos datos personales aquí)
    const passwordValidation = validatePasswordAgainstPersonalData(nuevaPassword, {
      nombre: usuario.nombre,
      email: usuario.email,
      telefono: usuario.telefono,
      fechaNacimiento: usuario.fechaNacimiento?.toISOString().split('T')[0],
      preguntaSeguridad: {
        respuesta: '', // No tenemos acceso a la respuesta en texto plano, pero validamos otros campos
      },
    });

    if (!passwordValidation.valid) {
      throw new BadRequestException(passwordValidation.reason);
    }

    const codigoInvalido = () =>
      new BadRequestException({ message: 'El código no es válido o ya venció.', code: 'CODIGO_INVALIDO' });
    const guardado = leerCodigo(usuario.codigoOTP);
    const vigente =
      guardado && guardado.intentos < MAX_INTENTOS_CODIGO && !!usuario.otpExpira && usuario.otpExpira.getTime() > Date.now();
    if (!vigente || !esCodigoConFormato(codigo)) {
      throw codigoInvalido();
    }

    // Se aparta el intento ANTES de comparar, con un update condicional: aunque lleguen varias
    // peticiones a la vez, nunca se prueban más de MAX_INTENTOS_CODIGO códigos.
    // Al llegar a MAX_INTENTOS_CODIGO el código queda inservible pero registrado (cuenta la hora).
    const apartado = guardarCodigo({ ...guardado, intentos: guardado.intentos + 1 });
    const reserva = await this.prisma.usuario.updateMany({
      where: { id, codigoOTP: usuario.codigoOTP },
      data: { codigoOTP: apartado },
    });
    if (reserva.count === 0) {
      throw codigoInvalido();
    }
    if (!hashesIguales(guardado.hash, hashCodigo(jwtSecretObligatorio(process.env.JWT_SECRET), id, codigo))) {
      throw codigoInvalido();
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);
    // En una sola escritura: contraseña nueva, código gastado y todas las sesiones revocadas.
    // tokensRevocadosDesde es el mismo mecanismo de logoutAll (SecurityService.revokeAllUserTokens):
    // JwtStrategy rechaza todo token emitido antes, incluido el de esta petición.
    const cambio = await this.prisma.usuario.updateMany({
      where: { id, codigoOTP: apartado },
      data: { password: hashedPassword, codigoOTP: null, otpExpira: null, tokensRevocadosDesde: new Date() },
    });
    if (cambio.count === 0) {
      throw codigoInvalido();
    }
    // Sesiones de la app móvil: /auth/movil/renovar ya rechaza las anteriores a tokensRevocadosDesde;
    // se marcan revocadas para que el registro quede claro. Si falla, el cambio sigue valiendo.
    try {
      await this.prisma.sesionMovil.updateMany({ where: { usuarioId: id, revocadaEn: null }, data: { revocadaEn: new Date() } });
    } catch {
      this.logger.warn(`No se pudieron marcar las sesiones móviles como revocadas (usuario ${id})`);
    }

    try {
      await this.emailService.sendAvisoPasswordCambiadaEmail(usuario.email, fechaHoraMexico(new Date()));
    } catch {
      // El cambio se mantiene; solo se registra (sin correo ni nombre).
      this.logger.warn(`No se pudo enviar el aviso de cambio de contraseña (usuario ${id})`);
    }

    return { success: true, message: 'Tu contraseña cambió. Inicia sesión de nuevo.' };
  }

  async obtenerPerfilUsuario(id: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        fechaNacimiento: true,
        googleId: true,
        foto: true,
        aceptaAvisoPrivacidad: true,
        recibePromociones: true,
        confirmado: true,
        creadoEn: true,
        actualizadoEn: true,
        activo: true,
        // Campos de perfil capilar embebidos
        tipoCabello: true,
        colorNatural: true,
        colorActual: true,
        productosUsados: true,
        alergias: true,
        // Pregunta de seguridad (sin respuesta)
        preguntaSeguridad: true,
        rol: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      success: true,
      data: usuario,
    };
  }

  async actualizarPerfilUsuario(id: string, updateData: any) {
    await this.validarFotoDelCliente(id, updateData.foto);
    const camposPermitidos = [
      'nombre', 'telefono', 'fechaNacimiento', 'recibePromociones', 'foto',
      // Campos de perfil capilar embebidos
      'tipoCabello', 'colorNatural', 'colorActual', 'productosUsados', 'alergias',
    ];
    const actualizaciones: any = {};

    // Sanitizar campos directos
    camposPermitidos.forEach(campo => {
      if (updateData[campo] !== undefined) {
        if (campo === 'foto') {
          const v = updateData.foto;
          if (v === null || (typeof v === 'string' && v.trim() === '')) {
            actualizaciones.foto = null;
          } else if (typeof v === 'string') {
            actualizaciones.foto = sanitizeInput(v.trim());
          }
          return;
        }
        // Sanitizar según el tipo de campo
        if (campo === 'telefono' && typeof updateData[campo] === 'string') {
          actualizaciones[campo] = sanitizePhone(updateData[campo]);
        } else if (typeof updateData[campo] === 'string' && ['nombre', 'colorNatural', 'colorActual', 'productosUsados', 'alergias'].includes(campo)) {
          actualizaciones[campo] = sanitizeInput(updateData[campo]);
        } else if (campo === 'fechaNacimiento') {
          actualizaciones.fechaNacimiento = this.normalizarFechaNacimiento(updateData.fechaNacimiento);
        } else {
          // Para campos no string restantes (recibePromociones, tipoCabello)
          actualizaciones[campo] = updateData[campo];
        }
      }
    });

    if (updateData.perfilCapilar) {
      const { perfilCapilar } = updateData;
      if (perfilCapilar.tipoCabello !== undefined) actualizaciones.tipoCabello = perfilCapilar.tipoCabello;
      if (perfilCapilar.colorNatural !== undefined) actualizaciones.colorNatural = sanitizeInput(perfilCapilar.colorNatural);
      if (perfilCapilar.colorActual !== undefined) actualizaciones.colorActual = sanitizeInput(perfilCapilar.colorActual);
      if (perfilCapilar.productosUsados !== undefined) actualizaciones.productosUsados = sanitizeInput(perfilCapilar.productosUsados);
      if (perfilCapilar.alergias !== undefined) actualizaciones.alergias = sanitizeInput(perfilCapilar.alergias);
    }

    // Tratamientos: sueltos (validados por el DTO) o dentro de perfilCapilar (objeto libre: se valida aquí).
    const pc = updateData.perfilCapilar ?? {};
    if (pc.tratamientosQuimicos !== undefined && typeof pc.tratamientosQuimicos !== 'boolean') {
      throw new BadRequestException('perfilCapilar.tratamientosQuimicos debe ser verdadero o falso');
    }
    if (
      pc.tratamientos !== undefined &&
      pc.tratamientos !== null &&
      (typeof pc.tratamientos !== 'string' || pc.tratamientos.length > MAX_TRATAMIENTOS)
    ) {
      throw new BadRequestException(`perfilCapilar.tratamientos debe ser texto de hasta ${MAX_TRATAMIENTOS} caracteres`);
    }
    Object.assign(
      actualizaciones,
      normalizarTratamientos(
        updateData.tratamientosQuimicos !== undefined ? updateData.tratamientosQuimicos : pc.tratamientosQuimicos,
        updateData.tratamientos !== undefined ? updateData.tratamientos : pc.tratamientos,
      ),
    );

    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: actualizaciones,
      select: SELECT_USUARIO_SEGURO,
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      success: true,
      message: 'Perfil actualizado correctamente',
      data: usuario,
    };
  }
}

