const Usuario = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendOTPEmail } = require('../utils/sendEmail');

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

    // Hashear la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Hashear la respuesta de seguridad
    const respuestaHasheada = await bcrypt.hash(preguntaSeguridad.respuesta.trim(), 10);

    // Generar código OTP de 6 dígitos
    const codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Calcular fecha de expiración (2 minutos desde ahora)
    const otpExpira = new Date(Date.now() + 2 * 60 * 1000);

    // Crear nuevo usuario con confirmado: false
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
      codigoOTP,
      otpExpira,
      confirmado: false, // IMPORTANTE: La cuenta no está confirmada aún
      activo: true
    });

    await nuevoUsuario.save();
    console.log('Usuario registrado:', email, 'OTP:', codigoOTP, 'Expira en 2 minutos');

    // Enviar correo con el código OTP
    try {
      await sendOTPEmail(email, codigoOTP);
      
      return res.status(201).json({ 
        success: true,
        message: 'Ingresa el código para activar tu cuenta. El código expira en 2 minutos.',
        requiereVerificacion: true // Indicar al frontend que requiere verificación
      });
    } catch (err) {
      console.error('Error al enviar correo de activación:', err);
      // Aún así, el usuario fue creado, pero no se pudo enviar el correo
      return res.status(500).json({
        success: false,
        message: 'Usuario registrado, pero no se pudo enviar el correo de activación. Contacta al soporte.'
      });
    }

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

    // VERIFICAR QUE LA CUENTA ESTÉ CONFIRMADA (excepto para usuarios de Google)
    if (!usuario.confirmado && !usuario.googleId) {
      return res.status(403).json({ 
        success: false,
        message: 'Tu cuenta no está activada. Revisa tu correo para activar tu cuenta.',
        requiereVerificacion: true // Indicar al frontend que requiere verificación
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

// ✅ Verificar OTP
exports.verificarOTP = async (req, res) => {
  try {
    const { email, codigo } = req.body;

    if (!email || !codigo) {
      return res.status(400).json({ 
        success: false,
        message: 'Email y código son requeridos' 
      });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado.' 
      });
    }

    // Verificar si hay código activo
    if (!usuario.codigoOTP) {
      return res.status(400).json({ 
        success: false,
        message: 'No hay código activo. Solicita uno nuevo.' 
      });
    }

    // Verificar si el código ha expirado (2 minutos)
    if (usuario.otpExpira < new Date()) {
      return res.status(400).json({ 
        success: false,
        message: 'Código expirado. El código OTP solo es válido por 2 minutos. Solicita uno nuevo.' 
      });
    }

    // Verificar que el código coincida
    if (usuario.codigoOTP !== codigo) {
      return res.status(400).json({ 
        success: false,
        message: 'Código incorrecto.' 
      });
    }

    // Código correcto: activar cuenta y limpiar código
    usuario.codigoOTP = null;
    usuario.otpExpira = null;
    usuario.confirmado = true;
    await usuario.save();

    res.status(200).json({ 
      success: true,
      message: 'Código verificado correctamente. Cuenta activada.' 
    });
  } catch (error) {
    console.error('Error al verificar el código:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error al verificar el código' 
    });
  }
};

// ✅ Reenviar código OTP
exports.reenviarCodigo = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'Email es requerido' 
      });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase() });
    if (!usuario) {
      return res.status(404).json({ 
        success: false,
        message: 'Usuario no encontrado.' 
      });
    }

    // Si ya está confirmado, no necesita código
    if (usuario.confirmado) {
      return res.status(400).json({
        success: false,
        message: 'Este correo electrónico ya está activado.'
      });
    }

    // Generar nuevo código OTP
    const nuevoCodigo = Math.floor(100000 + Math.random() * 900000).toString();
    usuario.codigoOTP = nuevoCodigo;
    usuario.otpExpira = new Date(Date.now() + 2 * 60 * 1000); // 2 minutos
    await usuario.save();

    // Enviar nuevo código por correo
    try {
      await sendOTPEmail(email, nuevoCodigo);
      res.status(200).json({ 
        success: true,
        message: 'Nuevo código enviado al correo. Recuerda que el código expira en 2 minutos.' 
      });
    } catch (emailError) {
      console.error('Error enviando correo:', emailError);
      res.status(500).json({
        success: false,
        message: 'Error al enviar el correo. Por favor intenta más tarde.'
      });
    }
  } catch (error) {
    console.error('Error al reenviar código:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error al reenviar el código' 
    });
  }
};

