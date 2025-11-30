import { Injectable, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { SecurityService } from '../common/services/security.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarOtpDto } from './dto/verificar-otp.dto';
import { ReenviarCodigoDto } from './dto/reenviar-codigo.dto';
import { sanitizeInput, containsSQLInjection, sanitizeForLogging, isCommonAnswer } from '../common/utils/security.util';
import { validatePasswordAgainstPersonalData } from '../common/validators/password.validator';

@Injectable()
export class UsuariosService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private smsService: SmsService,
    private jwtService: JwtService,
    private securityService: SecurityService,
  ) {}

  async crearUsuario(createUsuarioDto: CreateUsuarioDto) {
    const { nombre, email, telefono, password, fechaNacimiento, preguntaSeguridad, direccion, perfilCapilar, aceptaAvisoPrivacidad, recibePromociones, metodoVerificacion } = createUsuarioDto;

    // Sanitizar todas las entradas de texto
    const nombreSanitizado = sanitizeInput(nombre);
    const emailSanitizado = sanitizeInput(email.toLowerCase().trim());
    
    // Prevenir SQL injection
    if (
      containsSQLInjection(nombreSanitizado) ||
      containsSQLInjection(emailSanitizado) ||
      (telefono && containsSQLInjection(telefono)) ||
      containsSQLInjection(preguntaSeguridad.pregunta) ||
      containsSQLInjection(preguntaSeguridad.respuesta)
    ) {
      console.warn('⚠️ Intento de SQL injection detectado en crearUsuario:', sanitizeForLogging({ email: emailSanitizado }));
      throw new BadRequestException('Datos inválidos. Por favor verifica la información ingresada.');
    }

    // Verificar si el email ya existe
    const existe = await this.prisma.usuario.findUnique({
      where: { email: emailSanitizado },
    });

    if (existe) {
      throw new ConflictException('El email ya está registrado');
    }

    // Validar que la contraseña no contenga datos personales
    const passwordValidation = validatePasswordAgainstPersonalData(password, {
      nombre,
      email: emailSanitizado,
      telefono,
      fechaNacimiento,
      direccion,
      preguntaSeguridad,
    });

    if (!passwordValidation.valid) {
      throw new BadRequestException(passwordValidation.reason);
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Hashear la respuesta de seguridad
    const respuestaHasheada = await bcrypt.hash(preguntaSeguridad.respuesta.trim(), 10);

    // Generar código OTP de 6 dígitos
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos

    // Crear nuevo usuario con campos embebidos
    const preguntaGuardada = sanitizeInput(preguntaSeguridad.pregunta.trim());
    
    const nuevoUsuario = await this.prisma.usuario.create({
      data: {
        nombre: nombreSanitizado,
        email: emailSanitizado,
        telefono,
        password: hashedPassword,
        fechaNacimiento: new Date(fechaNacimiento),
        // Pregunta de seguridad embebida
        preguntaSeguridad: preguntaGuardada,
        respuestaSeguridad: respuestaHasheada,
        // Campos de dirección embebidos
        calle: direccion?.calle,
        numero: direccion?.numero,
        colonia: direccion?.colonia,
        ciudad: direccion?.ciudad,
        estado: direccion?.estado,
        codigoPostal: direccion?.codigoPostal,
        // Campos de perfil capilar embebidos
        tipoCabello: perfilCapilar?.tipoCabello as any,
        colorNatural: perfilCapilar?.colorNatural,
        colorActual: perfilCapilar?.colorActual,
        productosUsados: perfilCapilar?.productosUsados,
        alergias: perfilCapilar?.alergias,
        aceptaAvisoPrivacidad,
        recibePromociones: recibePromociones || false,
        codigoOTP,
        otpExpira,
        confirmado: false,
        activo: true,
      },
    });

    // Log seguro (sin datos sensibles)
    console.log('✅ Usuario registrado:', sanitizeForLogging({ email: emailSanitizado, id: nuevoUsuario.id }));

    // Enviar código OTP según el método seleccionado (email o sms)
    const metodo = metodoVerificacion || 'email'; // Por defecto email
    
    try {
      if (metodo === 'sms') {
        // Enviar SMS con el código OTP
        await this.smsService.sendOTPSMS(telefono, codigoOTP);
        return {
          success: true,
          message: 'Ingresa el código enviado a tu teléfono para activar tu cuenta. El código expira en 2 minutos.',
          requiereVerificacion: true,
          metodo: 'sms',
        };
      } else {
        // Enviar correo con el código OTP (método por defecto)
        await this.emailService.sendOTPEmail(emailSanitizado, codigoOTP);
        return {
          success: true,
          message: 'Ingresa el código para activar tu cuenta. El código expira en 2 minutos.',
          requiereVerificacion: true,
          metodo: 'email',
        };
      }
    } catch (err) {
      console.error(`Error al enviar código de activación por ${metodo}:`, err);
      const metodoTexto = metodo === 'sms' ? 'SMS' : 'correo';
      throw new Error(`Usuario registrado, pero no se pudo enviar el ${metodoTexto} de activación. Contacta al soporte.`);
    }
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Sanitizar y validar entrada
    const emailSanitizado = sanitizeInput(email.toLowerCase().trim());
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado) || containsSQLInjection(password)) {
      console.warn('⚠️ Intento de SQL injection detectado:', sanitizeForLogging({ email: emailSanitizado }));
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

    // Generar token JWT con información de actividad
    const now = Math.floor(Date.now() / 1000);
    const token = this.jwtService.sign(
      { 
        id: usuario.id, 
        email: usuario.email,
        jti: crypto.randomBytes(16).toString('hex'), // Token ID único
        lastActivity: now,
      },
      { expiresIn: '1d' },
    );

    // Log seguro (sin contraseña)
    console.log('✅ Login exitoso:', sanitizeForLogging({ id: usuario.id, email: usuario.email }));

    return {
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      usuario: {
        _id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
      },
    };
  }

  async verificarOTP(verificarOtpDto: VerificarOtpDto) {
    const { email, codigo } = verificarOtpDto;

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    if (!usuario.codigoOTP) {
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
    const { email, metodoVerificacion } = reenviarCodigoDto;

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
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

    // Enviar código según el método seleccionado
    const metodo = metodoVerificacion || 'email'; // Por defecto email

    try {
      if (metodo === 'sms') {
        // Enviar SMS con el nuevo código OTP
        await this.smsService.sendOTPSMS(usuario.telefono, nuevoCodigo);
        return {
          success: true,
          message: 'Nuevo código enviado a tu teléfono. Recuerda que el código expira en 2 minutos.',
          metodo: 'sms',
        };
      } else {
        // Enviar correo con el nuevo código OTP (método por defecto)
        await this.emailService.sendOTPEmail(email, nuevoCodigo);
        return {
          success: true,
          message: 'Nuevo código enviado al correo. Recuerda que el código expira en 2 minutos.',
          metodo: 'email',
        };
      }
    } catch (error) {
      console.error(`Error enviando código por ${metodo}:`, error);
      const metodoTexto = metodo === 'sms' ? 'SMS' : 'correo';
      throw new Error(`Error al enviar el ${metodoTexto}. Por favor intenta más tarde.`);
    }
  }

  async verificarCorreoExistente(correo: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: correo.toLowerCase() },
    });

    if (usuario) {
      return { existe: true, message: 'Este correo ya está registrado' };
    }

    return { existe: false, message: 'Correo disponible' };
  }

  async obtenerUsuarios() {
    const usuarios = await this.prisma.usuario.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        fechaNacimiento: true,
        // NO incluir preguntaSeguridad (información sensible)
        // Campos de dirección embebidos
        calle: true,
        numero: true,
        colonia: true,
        ciudad: true,
        estado: true,
        codigoPostal: true,
        // Campos de perfil capilar embebidos
        tipoCabello: true,
        colorNatural: true,
        colorActual: true,
        productosUsados: true,
        alergias: true,
        googleId: true,
        foto: true,
        aceptaAvisoPrivacidad: true,
        recibePromociones: true,
        confirmado: true,
        creadoEn: true,
        actualizadoEn: true,
        activo: true,
        // NO incluir: password, respuestaSeguridad, codigoOTP, resetPasswordToken
      },
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
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        fechaNacimiento: true,
        preguntaSeguridad: true,
        // Campos de dirección embebidos
        calle: true,
        numero: true,
        colonia: true,
        ciudad: true,
        estado: true,
        codigoPostal: true,
        // Campos de perfil capilar embebidos
        tipoCabello: true,
        colorNatural: true,
        colorActual: true,
        productosUsados: true,
        alergias: true,
        googleId: true,
        foto: true,
        aceptaAvisoPrivacidad: true,
        recibePromociones: true,
        confirmado: true,
        creadoEn: true,
        actualizadoEn: true,
        activo: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Las respuestas ya no se incluyen en el select, no hay nada que ocultar

    return {
      success: true,
      data: usuario,
    };
  }

  async actualizarUsuario(id: string, updateData: any) {
    const { email, password, ...camposActualizables } = updateData;

    const usuarioActualizado = await this.prisma.usuario.update({
      where: { id },
      data: camposActualizables,
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

  async solicitarEnlaceRecuperacion(email: string) {
    // Sanitizar entrada
    const emailSanitizado = sanitizeInput(email.toLowerCase().trim());
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado)) {
      console.warn('⚠️ Intento de SQL injection en solicitarEnlaceRecuperacion:', sanitizeForLogging({ email: emailSanitizado }));
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
      console.log('⚠️ Intento de recuperación para usuario de Google:', sanitizeForLogging({ email: emailSanitizado }));
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
      
      console.log('✅ Enlace de recuperación enviado a:', sanitizeForLogging({ email: emailSanitizado }));
      
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
    const emailSanitizado = sanitizeInput(email.toLowerCase().trim());
    
    // Prevenir SQL injection
    if (containsSQLInjection(emailSanitizado)) {
      console.warn('⚠️ Intento de SQL injection en obtenerPreguntaSeguridad:', sanitizeForLogging({ email: emailSanitizado }));
      throw new NotFoundException('No se encontró pregunta de seguridad para este correo');
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
      throw new NotFoundException('No se encontró pregunta de seguridad para este correo');
    }

    // Si es un usuario de Google y no tiene pregunta de seguridad
    if (usuario.googleId && !usuario.preguntaSeguridad) {
      throw new NotFoundException('Este correo está asociado a una cuenta de Google. No se puede usar recuperación de contraseña por pregunta de seguridad. Usa "Continuar con Google" para iniciar sesión.');
    }

    if (!usuario.preguntaSeguridad) {
      throw new NotFoundException('No se encontró pregunta de seguridad para este correo');
    }

    return {
      success: true,
      pregunta: usuario.preguntaSeguridad,
    };
  }

  async validarRespuestaSeguridad(email: string, respuesta: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        respuestaSeguridad: true,
      },
    });

    if (!usuario) {
      throw new NotFoundException('Correo no encontrado');
    }

    if (!usuario.respuestaSeguridad) {
      throw new NotFoundException('No se encontró respuesta de seguridad');
    }

    const respuestaValida = await bcrypt.compare(
      respuesta.trim(),
      usuario.respuestaSeguridad,
    );
    if (!respuestaValida) {
      throw new UnauthorizedException('Respuesta incorrecta');
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
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email: email.toLowerCase(),
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
    // Verificar que el token existe, no está expirado y no ha sido usado
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email: email.toLowerCase(),
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
      direccion: {
        calle: usuario.calle,
        colonia: usuario.colonia,
      },
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
      },
    });

    return {
      success: true,
      message: 'Contraseña actualizada correctamente. Tu cuenta ha sido verificada automáticamente.',
    };
  }

  async cambiarPasswordDesdePerfil(id: string, actualPassword: string, nuevaPassword: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id },
    });

    if (!usuario || !usuario.password) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const esValida = await bcrypt.compare(actualPassword, usuario.password);
    if (!esValida) {
      throw new UnauthorizedException('Contraseña actual incorrecta');
    }

    // Validar que la nueva contraseña no sea igual a la anterior
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
      direccion: {
        calle: usuario.calle,
        colonia: usuario.colonia,
      },
      preguntaSeguridad: {
        respuesta: '', // No tenemos acceso a la respuesta en texto plano, pero validamos otros campos
      },
    });

    if (!passwordValidation.valid) {
      throw new BadRequestException(passwordValidation.reason);
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);

    await this.prisma.usuario.update({
      where: { id },
      data: {
        password: hashedPassword,
      },
    });

    return {
      success: true,
      message: 'Contraseña actualizada correctamente',
    };
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
        // Campos de dirección embebidos
        calle: true,
        numero: true,
        colonia: true,
        ciudad: true,
        estado: true,
        codigoPostal: true,
        // Campos de perfil capilar embebidos
        tipoCabello: true,
        colorNatural: true,
        colorActual: true,
        productosUsados: true,
        alergias: true,
        // Pregunta de seguridad (sin respuesta)
        preguntaSeguridad: true,
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
    const camposPermitidos = [
      'nombre', 'telefono', 'fechaNacimiento', 'recibePromociones',
      // Campos de dirección embebidos
      'calle', 'numero', 'colonia', 'ciudad', 'estado', 'codigoPostal',
      // Campos de perfil capilar embebidos
      'tipoCabello', 'colorNatural', 'colorActual', 'productosUsados', 'alergias',
    ];
    const actualizaciones: any = {};

    // Manejar campos directos
    camposPermitidos.forEach(campo => {
      if (updateData[campo] !== undefined) {
        actualizaciones[campo] = updateData[campo];
      }
    });

    // Manejar objetos direccion y perfilCapilar si vienen como objetos
    if (updateData.direccion) {
      const { direccion } = updateData;
      if (direccion.calle !== undefined) actualizaciones.calle = direccion.calle;
      if (direccion.numero !== undefined) actualizaciones.numero = direccion.numero;
      if (direccion.colonia !== undefined) actualizaciones.colonia = direccion.colonia;
      if (direccion.ciudad !== undefined) actualizaciones.ciudad = direccion.ciudad;
      if (direccion.estado !== undefined) actualizaciones.estado = direccion.estado;
      if (direccion.codigoPostal !== undefined) actualizaciones.codigoPostal = direccion.codigoPostal;
    }

    if (updateData.perfilCapilar) {
      const { perfilCapilar } = updateData;
      if (perfilCapilar.tipoCabello !== undefined) actualizaciones.tipoCabello = perfilCapilar.tipoCabello;
      if (perfilCapilar.colorNatural !== undefined) actualizaciones.colorNatural = perfilCapilar.colorNatural;
      if (perfilCapilar.colorActual !== undefined) actualizaciones.colorActual = perfilCapilar.colorActual;
      if (perfilCapilar.productosUsados !== undefined) actualizaciones.productosUsados = perfilCapilar.productosUsados;
      if (perfilCapilar.alergias !== undefined) actualizaciones.alergias = perfilCapilar.alergias;
    }

    const usuario = await this.prisma.usuario.update({
      where: { id },
      data: actualizaciones,
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

