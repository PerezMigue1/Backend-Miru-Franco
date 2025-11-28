import { Injectable, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { LoginDto } from './dto/login.dto';
import { VerificarOtpDto } from './dto/verificar-otp.dto';
import { ReenviarCodigoDto } from './dto/reenviar-codigo.dto';

@Injectable()
export class UsuariosService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private jwtService: JwtService,
  ) {}

  async crearUsuario(createUsuarioDto: CreateUsuarioDto) {
    const { nombre, email, telefono, password, fechaNacimiento, preguntaSeguridad, direccion, perfilCapilar, aceptaAvisoPrivacidad, recibePromociones } = createUsuarioDto;

    // Verificar si el email ya existe
    const existe = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existe) {
      throw new ConflictException('El email ya está registrado');
    }

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Hashear la respuesta de seguridad
    const respuestaHasheada = await bcrypt.hash(preguntaSeguridad.respuesta.trim(), 10);

    // Generar código OTP de 6 dígitos
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos

    // Crear nuevo usuario con campos embebidos
    const nuevoUsuario = await this.prisma.usuario.create({
      data: {
        nombre,
        email: email.toLowerCase(),
        telefono,
        password: hashedPassword,
        fechaNacimiento: new Date(fechaNacimiento),
        // Pregunta de seguridad embebida
        preguntaSeguridad: preguntaSeguridad.pregunta.trim(),
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

    console.log('Usuario registrado:', email, 'OTP:', codigoOTP, 'Expira en 2 minutos');

    // Enviar correo con el código OTP
    try {
      await this.emailService.sendOTPEmail(email, codigoOTP);
      return {
        success: true,
        message: 'Ingresa el código para activar tu cuenta. El código expira en 2 minutos.',
        requiereVerificacion: true,
      };
    } catch (err) {
      console.error('Error al enviar correo de activación:', err);
      throw new Error('Usuario registrado, pero no se pudo enviar el correo de activación. Contacta al soporte.');
    }
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!usuario.activo) {
      throw new ForbiddenException('Usuario inactivo');
    }

    if (!usuario.password) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    const esValido = await bcrypt.compare(password, usuario.password);
    if (!esValido) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    // Verificar que la cuenta esté confirmada (excepto para usuarios de Google)
    if (!usuario.confirmado && !usuario.googleId) {
      throw new ForbiddenException('Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.');
    }

    // Generar token JWT
    const token = this.jwtService.sign(
      { id: usuario.id, email: usuario.email },
      { expiresIn: '1d' },
    );

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
    const { email } = reenviarCodigoDto;

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

    try {
      await this.emailService.sendOTPEmail(email, nuevoCodigo);
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

    // Las respuestas ya no se incluyen en el select, no hay nada que ocultar

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

  async obtenerPreguntaSeguridad(email: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      include: { preguntaSeguridad: true },
    });

    if (!usuario) {
      throw new NotFoundException('Correo no encontrado');
    }

    if (!usuario.activo) {
      throw new ForbiddenException('Usuario inactivo');
    }

    if (!usuario.preguntaSeguridad) {
      throw new NotFoundException('No se encontró pregunta de seguridad para este usuario');
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

    // Generar token temporal válido por 15 minutos
    const token = crypto.randomBytes(32).toString('hex');
    const resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);

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

  async cambiarPassword(email: string, token: string, nuevaPassword: string) {
    if (nuevaPassword.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres');
    }

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
      throw new BadRequestException('Token inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    return {
      success: true,
      message: 'Contraseña actualizada correctamente',
    };
  }

  async cambiarPasswordDesdePerfil(id: string, actualPassword: string, nuevaPassword: string) {
    if (nuevaPassword.length < 6) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 6 caracteres');
    }

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

