const Usuario = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { generarTokenVerificacion } = require('../utils/emailVerification');
const { enviarEmailVerificacion } = require('../services/emailService');

// ✅ Obtener todos los usuarios
exports.obtenerUsuarios = async (req, res) => {
  try {
    const usuarios = await Usuario.find({ activo: true }).select('-password -resetPasswordToken');
    
    // Ocultar respuesta de preguntaSeguridad
    const usuariosSinRespuesta = usuarios.map(usuario => {
      const usuarioObj = usuario.toObject();
      if (usuarioObj.preguntaSeguridad && usuarioObj.preguntaSeguridad.respuesta) {
        delete usuarioObj.preguntaSeguridad.respuesta;
      }
      return usuarioObj;
    });
    
    res.json({
      success: true,
      count: usuariosSinRespuesta.length,
      data: usuariosSinRespuesta
    });
  } catch (error) {
    console.error('❌ Error al obtener usuarios:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Crear nuevo usuario (Registro)
exports.crearUsuario = async (req, res) => {
  try {
    const {
      nombre, email, telefono, password,
      fechaNacimiento, preguntaSeguridad,
      direccion, perfilCapilar,
      aceptaAvisoPrivacidad, recibePromociones
    } = req.body;

    // Validación de campos requeridos
    if (!nombre || !email || !telefono || !password || !fechaNacimiento ||
        !preguntaSeguridad || !direccion || !perfilCapilar || aceptaAvisoPrivacidad === undefined) {
      return res.status(400).json({ 
        success: false,
        message: 'Faltan campos obligatorios' 
      });
    }

    // Validar estructura de preguntaSeguridad
    if (!preguntaSeguridad.pregunta || !preguntaSeguridad.respuesta) {
      return res.status(400).json({ 
        success: false,
        message: 'preguntaSeguridad debe contener pregunta y respuesta' 
      });
    }

    // Verificar si el email ya existe
    const existe = await Usuario.findOne({ email: email.toLowerCase() });
    if (existe) {
      return res.status(400).json({ 
        success: false,
        message: 'El email ya está registrado' 
      });
    }

    // Generar token de verificación
    const tokenVerificacion = generarTokenVerificacion();
    const fechaExpiracion = new Date();
    fechaExpiracion.setHours(fechaExpiracion.getHours() + 24); // Expira en 24 horas

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Hashear la respuesta de seguridad
    const respuestaHasheada = await bcrypt.hash(preguntaSeguridad.respuesta.trim(), 10);

    // Crear nuevo usuario
    const nuevoUsuario = new Usuario({
      nombre,
      email: email.toLowerCase(),
      telefono,
      password: hashedPassword,
      fechaNacimiento,
      preguntaSeguridad: {
        pregunta: preguntaSeguridad.pregunta.trim(),
        respuesta: respuestaHasheada
      },
      direccion,
      perfilCapilar,
      aceptaAvisoPrivacidad,
      recibePromociones: recibePromociones || false,
      emailVerificado: false,
      emailVerificacionToken: tokenVerificacion,
      emailVerificacionExpira: fechaExpiracion,
      activo: true
    });

    await nuevoUsuario.save();

    // Enviar email de verificación
    let emailEnviado = false;
    try {
      await enviarEmailVerificacion(email, tokenVerificacion);
      emailEnviado = true;
    } catch (emailError) {
      console.error('Error enviando email de verificación:', emailError);
      // No fallar el registro si el email falla, pero loguear el error
      emailEnviado = false;
    }

    const mensaje = emailEnviado 
      ? 'Registro exitoso. Por favor verifica tu correo electrónico para activar tu cuenta.'
      : 'Registro exitoso. No se pudo enviar el email de verificación. Puedes solicitar un nuevo email de verificación desde la página de login.';

    res.status(201).json({
      success: true,
      message: mensaje,
      emailEnviado: emailEnviado,
      requiereVerificacion: true,
      usuario: {
        _id: nuevoUsuario._id,
        nombre: nuevoUsuario.nombre,
        email: nuevoUsuario.email
      }
    });

  } catch (error) {
    console.error('❌ Error al crear usuario:', error);
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        message: 'El email ya está registrado' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error interno del servidor' 
    });
  }
};

// ✅ Login de usuario
exports.loginUsuario = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Email y contraseña son requeridos' 
      });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });

    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({ 
        success: false,
        message: 'Usuario inactivo' 
      });
    }

    const esValido = await bcrypt.compare(password, usuario.password);
    if (!esValido) {
      return res.status(401).json({ 
        success: false,
        message: 'Contraseña incorrecta' 
      });
    }

    // Verificar si el email está verificado (excepto para usuarios de Google)
    if (!usuario.emailVerificado && !usuario.googleId) {
      return res.status(403).json({
        success: false,
        message: 'Por favor verifica tu correo electrónico antes de iniciar sesión. Si no recibiste el email, puedes solicitar uno nuevo.',
        requiereVerificacion: true,
        puedeReenviar: true
      });
    }

    // Generar token JWT
    const token = jwt.sign(
      { id: usuario._id, email: usuario.email },
      process.env.JWT_SECRET || 'tu_secreto_temporal',
      { expiresIn: '1d' }
    );

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso',
      token,
      usuario: {
        _id: usuario._id,
        nombre: usuario.nombre,
        email: usuario.email
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Obtener usuario por ID
exports.obtenerUsuarioPorId = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de usuario inválido' 
      });
    }
    
    const usuario = await Usuario.findById(id).select('-password -resetPasswordToken');
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }
    
    // Ocultar respuesta de preguntaSeguridad
    const usuarioObj = usuario.toObject();
    if (usuarioObj.preguntaSeguridad && usuarioObj.preguntaSeguridad.respuesta) {
      delete usuarioObj.preguntaSeguridad.respuesta;
    }
    
    res.status(200).json({
      success: true,
      data: usuarioObj
    });
  } catch (error) {
    console.error('❌ Error al obtener usuario:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Actualizar usuario por ID
exports.actualizarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de usuario inválido' 
      });
    }

    // No permitir cambiar email o password directamente
    const { email, password, ...camposActualizables } = req.body;

    const usuarioActualizado = await Usuario.findByIdAndUpdate(
      id,
      { ...camposActualizables, actualizadoEn: new Date() },
      { new: true, runValidators: true }
    );

    if (!usuarioActualizado) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }

    res.json({
      success: true,
      message: 'Usuario actualizado correctamente',
      data: usuarioActualizado
    });

  } catch (error) {
    console.error('❌ Error al actualizar usuario:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Eliminar usuario por ID (soft delete)
exports.eliminarUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de usuario inválido' 
      });
    }

    const usuario = await Usuario.findByIdAndUpdate(
      id,
      { activo: false, actualizadoEn: new Date() },
      { new: true }
    );

    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }

    res.json({
      success: true,
      message: 'Usuario eliminado correctamente'
    });

  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Recuperar contraseña - Paso 1: Obtener pregunta de seguridad
exports.obtenerPreguntaSeguridad = async (req, res) => {
  try {
    const { email } = req.body;
    const usuario = await Usuario.findOne({ email: email.toLowerCase() });

    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Correo no encontrado' 
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({ 
        success: false,
        message: 'Usuario inactivo' 
      });
    }

    res.json({ 
      success: true,
      pregunta: usuario.preguntaSeguridad.pregunta 
    });

  } catch (error) {
    console.error('❌ Error al obtener pregunta de seguridad:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Recuperar contraseña - Paso 2: Validar respuesta y generar token
exports.validarRespuestaSeguridad = async (req, res) => {
  try {
    const { email, respuesta } = req.body;
    const usuario = await Usuario.findOne({ email: email.toLowerCase() });

    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Correo no encontrado' 
      });
    }

    // Verificar respuesta usando bcrypt (comparar hash)
    const respuestaValida = await bcrypt.compare(respuesta.trim(), usuario.preguntaSeguridad.respuesta);

    if (!respuestaValida) {
      return res.status(401).json({
        success: false,
        message: 'Respuesta incorrecta'
      });
    }

    // Generar token temporal válido por 15 minutos
    const token = crypto.randomBytes(32).toString('hex');
    usuario.resetPasswordToken = token;
    usuario.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 min
    await usuario.save();

    res.json({
      success: true,
      token,
      email: usuario.email
    });

  } catch (error) {
    console.error('❌ Error al validar respuesta:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Recuperar contraseña - Paso 3: Cambiar contraseña con token
exports.cambiarPassword = async (req, res) => {
  try {
    const { email, token, nuevaPassword } = req.body;

    if (!nuevaPassword || nuevaPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    const usuario = await Usuario.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!usuario) {
      return res.status(400).json({ 
        success: false,
        message: 'Token inválido o expirado' 
      });
    }

    usuario.password = await bcrypt.hash(nuevaPassword, 10);
    usuario.resetPasswordToken = undefined;
    usuario.resetPasswordExpires = undefined;
    usuario.actualizadoEn = new Date();
    await usuario.save();

    res.json({ 
      success: true,
      message: 'Contraseña actualizada correctamente' 
    });

  } catch (error) {
    console.error('❌ Error al cambiar contraseña:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Cambiar contraseña desde perfil (requiere contraseña actual)
exports.cambiarPasswordDesdePerfil = async (req, res) => {
  try {
    const { id } = req.params;
    const { actualPassword, nuevaPassword } = req.body;

    if (!actualPassword || !nuevaPassword) {
      return res.status(400).json({ 
        success: false,
        message: 'Contraseña actual y nueva contraseña son requeridas' 
      });
    }

    if (nuevaPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres' 
      });
    }

    const usuario = await Usuario.findById(id);
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }

    const esValida = await bcrypt.compare(actualPassword, usuario.password);
    if (!esValida) {
      return res.status(401).json({ 
        success: false,
        message: 'Contraseña actual incorrecta' 
      });
    }

    usuario.password = await bcrypt.hash(nuevaPassword, 10);
    usuario.actualizadoEn = new Date();
    await usuario.save();

    res.json({ 
      success: true,
      message: 'Contraseña actualizada correctamente' 
    });

  } catch (error) {
    console.error('❌ Error al cambiar contraseña desde perfil:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Obtener perfil de usuario
exports.obtenerPerfilUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await Usuario.findById(id).select('-password -resetPasswordToken -resetPasswordExpires');
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }
    
    // Ocultar respuesta de preguntaSeguridad
    const usuarioObj = usuario.toObject();
    if (usuarioObj.preguntaSeguridad && usuarioObj.preguntaSeguridad.respuesta) {
      delete usuarioObj.preguntaSeguridad.respuesta;
    }
    
    res.json({
      success: true,
      data: usuarioObj
    });
  } catch (error) {
    console.error('❌ Error al obtener perfil:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Actualizar perfil de usuario
exports.actualizarPerfilUsuario = async (req, res) => {
  try {
    const { id } = req.params;
    const camposPermitidos = ['nombre', 'telefono', 'fechaNacimiento', 'direccion', 'perfilCapilar', 'recibePromociones'];
    const actualizaciones = {};

    camposPermitidos.forEach(campo => {
      if (req.body[campo] !== undefined) {
        actualizaciones[campo] = req.body[campo];
      }
    });

    actualizaciones.actualizadoEn = new Date();

    const usuario = await Usuario.findByIdAndUpdate(id, actualizaciones, { new: true, runValidators: true });
    
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado' 
      });
    }

    res.json({ 
      success: true,
      message: 'Perfil actualizado correctamente', 
      data: usuario 
    });
  } catch (error) {
    console.error('❌ Error al actualizar perfil:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Verificar email
exports.verificarEmail = async (req, res) => {
  try {
    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token y email son requeridos' 
      });
    }

    const usuario = await Usuario.findOne({ 
      email: email.toLowerCase(),
      emailVerificacionToken: token
    });

    if (!usuario) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token de verificación inválido' 
      });
    }

    // Verificar si el token expiró
    if (new Date() > usuario.emailVerificacionExpira) {
      return res.status(400).json({ 
        success: false, 
        message: 'El token de verificación ha expirado. Solicita uno nuevo.' 
      });
    }

    // Verificar el email
    usuario.emailVerificado = true;
    usuario.emailVerificacionToken = null;
    usuario.emailVerificacionExpira = null;
    await usuario.save();

    res.json({
      success: true,
      message: 'Correo electrónico verificado exitosamente'
    });
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al verificar el correo electrónico' 
    });
  }
};

// ✅ Reenviar email de verificación
exports.reenviarEmailVerificacion = async (req, res) => {
  try {
    const { email } = req.body;

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });

    if (!usuario) {
      // Por seguridad, no revelar si el email existe o no
      return res.json({
        success: true,
        message: 'Si el correo existe, se enviará un nuevo email de verificación'
      });
    }

    if (usuario.emailVerificado) {
      return res.status(400).json({
        success: false,
        message: 'Este correo electrónico ya está verificado'
      });
    }

    // Generar nuevo token
    const tokenVerificacion = generarTokenVerificacion();
    const fechaExpiracion = new Date();
    fechaExpiracion.setHours(fechaExpiracion.getHours() + 24);

    usuario.emailVerificacionToken = tokenVerificacion;
    usuario.emailVerificacionExpira = fechaExpiracion;
    await usuario.save();

    // Enviar email
    try {
      await enviarEmailVerificacion(usuario.email, tokenVerificacion);
      res.json({
        success: true,
        message: 'Se ha enviado un nuevo email de verificación. Por favor revisa tu bandeja de entrada y carpeta de spam.',
        emailEnviado: true
      });
    } catch (emailError) {
      console.error('Error enviando email:', emailError);
      
      // Verificar si es un problema de configuración o del servicio
      const esErrorConfiguracion = emailError.message && 
        emailError.message.includes('no disponible');
      
      res.status(500).json({
        success: false,
        message: esErrorConfiguracion 
          ? 'El servicio de email no está disponible temporalmente. Por favor intenta más tarde o contacta al administrador.'
          : 'Error al enviar el email de verificación. Por favor verifica que el email esté correcto y que esté autorizado en Mailgun.',
        emailEnviado: false,
        error: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }
  } catch (error) {
    console.error('Error reenviando email:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar la solicitud'
    });
  }
};
