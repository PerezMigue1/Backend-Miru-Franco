const RecuperarPassword = require('../models/RecuperarPassword');
const crypto = require('crypto');

// ✅ Obtener todas las solicitudes de recuperación
exports.obtenerSolicitudes = async (req, res) => {
  try {
    const solicitudes = await RecuperarPassword.find()
      .sort({ creadoEn: -1 });
    
    res.json({
      success: true,
      count: solicitudes.length,
      data: solicitudes
    });
  } catch (error) {
    console.error('❌ Error al obtener solicitudes:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Crear nueva solicitud de recuperación
exports.crearSolicitud = async (req, res) => {
  try {
    const { email, minutosExpiracion } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false,
        message: 'El email es requerido' 
      });
    }

    // Generar token único
    const token = crypto.randomBytes(32).toString('hex');

    // Tiempo de expiración (por defecto 15 minutos)
    const minutos = minutosExpiracion || 15;
    const fechaExpiracion = Date.now() + (minutos * 60 * 1000);

    // Invalidar solicitudes previas del mismo email que no se hayan usado
    await RecuperarPassword.updateMany(
      { email: email.toLowerCase(), usado: false },
      { usado: true }
    );

    // Crear nueva solicitud
    const nuevaSolicitud = new RecuperarPassword({
      email: email.toLowerCase(),
      token,
      fechaExpiracion,
      usado: false
    });

    await nuevaSolicitud.save();

    res.status(201).json({
      success: true,
      message: 'Solicitud de recuperación creada correctamente',
      data: {
        _id: nuevaSolicitud._id,
        email: nuevaSolicitud.email,
        token: nuevaSolicitud.token,
        fechaExpiracion: nuevaSolicitud.fechaExpiracion
      }
    });

  } catch (error) {
    console.error('❌ Error al crear solicitud:', error);
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        message: 'Token duplicado, intenta de nuevo' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error interno del servidor' 
    });
  }
};

// ✅ Obtener solicitud por token
exports.obtenerPorToken = async (req, res) => {
  try {
    const { token } = req.params;

    const solicitud = await RecuperarPassword.findOne({ token });

    if (!solicitud) {
      return res.status(404).json({ 
        success: false,
        message: 'Solicitud no encontrada' 
      });
    }

    // Verificar si ya expiró
    if (new Date() > solicitud.fechaExpiracion) {
      return res.status(400).json({ 
        success: false,
        message: 'El token ha expirado',
        expirado: true
      });
    }

    // Verificar si ya fue usado
    if (solicitud.usado) {
      return res.status(400).json({ 
        success: false,
        message: 'El token ya fue utilizado',
        usado: true
      });
    }

    res.json({
      success: true,
      data: solicitud
    });

  } catch (error) {
    console.error('❌ Error al obtener solicitud:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Obtener solicitudes por email
exports.obtenerPorEmail = async (req, res) => {
  try {
    const { email } = req.params;

    const solicitudes = await RecuperarPassword.find({ 
      email: email.toLowerCase() 
    }).sort({ creadoEn: -1 });

    res.json({
      success: true,
      count: solicitudes.length,
      data: solicitudes
    });

  } catch (error) {
    console.error('❌ Error al obtener solicitudes por email:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Validar token (verificar si es válido y no ha expirado)
exports.validarToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        success: false,
        message: 'El token es requerido' 
      });
    }

    const solicitud = await RecuperarPassword.findOne({ token });

    if (!solicitud) {
      return res.status(400).json({ 
        success: false,
        message: 'Token inválido',
        valido: false
      });
    }

    // Verificar si ya expiró
    if (new Date() > solicitud.fechaExpiracion) {
      return res.status(400).json({ 
        success: false,
        message: 'El token ha expirado',
        valido: false,
        expirado: true
      });
    }

    // Verificar si ya fue usado
    if (solicitud.usado) {
      return res.status(400).json({ 
        success: false,
        message: 'El token ya fue utilizado',
        valido: false,
        usado: true
      });
    }

    res.json({
      success: true,
      message: 'Token válido',
      valido: true,
      data: {
        email: solicitud.email,
        fechaExpiracion: solicitud.fechaExpiracion
      }
    });

  } catch (error) {
    console.error('❌ Error al validar token:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Marcar token como usado
exports.marcarComoUsado = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        success: false,
        message: 'El token es requerido' 
      });
    }

    const solicitud = await RecuperarPassword.findOneAndUpdate(
      { token },
      { usado: true, actualizadoEn: new Date() },
      { new: true }
    );

    if (!solicitud) {
      return res.status(404).json({ 
        success: false,
        message: 'Solicitud no encontrada' 
      });
    }

    res.json({
      success: true,
      message: 'Token marcado como usado',
      data: solicitud
    });

  } catch (error) {
    console.error('❌ Error al marcar token como usado:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Eliminar solicitud por ID
exports.eliminarSolicitud = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de solicitud inválido' 
      });
    }

    const solicitud = await RecuperarPassword.findByIdAndDelete(id);

    if (!solicitud) {
      return res.status(404).json({ 
        success: false,
        message: 'Solicitud no encontrada' 
      });
    }

    res.json({
      success: true,
      message: 'Solicitud eliminada correctamente'
    });

  } catch (error) {
    console.error('❌ Error al eliminar solicitud:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

