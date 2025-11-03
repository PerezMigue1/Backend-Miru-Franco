const PreguntaSeguridad = require('../models/PreguntaSeguridad');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
// Modelo dinamico para la coleccion de usuarios (usa esquema laxo)
const Usuario = mongoose.models.Usuario || mongoose.model('Usuario', new mongoose.Schema({}, { strict: false }), 'usuarios');
// const jwt = require('jsonwebtoken'); // opcional si emites token para reset

// ✅ Obtener todas las preguntas de seguridad (catálogo y asignadas)
exports.obtenerPreguntas = async (req, res) => {
  try {
    const preguntas = await PreguntaSeguridad.find().sort({ _id: -1 });
    
    res.json({
      success: true,
      count: preguntas.length,
      data: preguntas
    });
  } catch (error) {
    console.error('❌ Error al obtener preguntas:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Obtener pregunta por ID
exports.obtenerPorId = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de pregunta inválido' 
      });
    }

    const pregunta = await PreguntaSeguridad.findById(id);

    if (!pregunta) {
      return res.status(404).json({ 
        success: false,
        message: 'Pregunta no encontrada' 
      });
    }

    res.json({
      success: true,
      data: pregunta
    });

  } catch (error) {
    console.error('❌ Error al obtener pregunta:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Crear nueva pregunta de seguridad
exports.crearPregunta = async (req, res) => {
  try {
    const { pregunta, email, respuesta } = req.body;

    if (!pregunta || !pregunta.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'La pregunta es requerida' 
      });
    }

    const nuevaPregunta = new PreguntaSeguridad({
      pregunta: pregunta.trim(),
      email: email ? String(email).toLowerCase().trim() : null
    });

    if (respuesta) {
      await nuevaPregunta.setRespuesta(respuesta);
    }

    await nuevaPregunta.save();

    res.status(201).json({
      success: true,
      message: 'Pregunta creada correctamente',
      data: nuevaPregunta
    });

  } catch (error) {
    console.error('❌ Error al crear pregunta:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error interno del servidor' 
    });
  }
};

// ✅ Actualizar pregunta de seguridad
exports.actualizarPregunta = async (req, res) => {
  try {
    const { id } = req.params;
    const { pregunta, respuesta, email } = req.body;

    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de pregunta inválido' 
      });
    }

    if (!pregunta || !pregunta.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'La pregunta es requerida' 
      });
    }

    const preguntaActualizada = await PreguntaSeguridad.findById(id);
    if (!preguntaActualizada) {
      return res.status(404).json({ 
        success: false,
        message: 'Pregunta no encontrada' 
      });
    }

    preguntaActualizada.pregunta = pregunta.trim();
    if (typeof email === 'string') {
      preguntaActualizada.email = email.toLowerCase().trim();
    }
    if (respuesta) {
      await preguntaActualizada.setRespuesta(respuesta);
    }
    await preguntaActualizada.save();

    res.json({
      success: true,
      message: 'Pregunta actualizada correctamente',
      data: preguntaActualizada
    });

  } catch (error) {
    console.error('❌ Error al actualizar pregunta:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Eliminar pregunta de seguridad
exports.eliminarPregunta = async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el ID es válido para MongoDB
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: 'ID de pregunta inválido' 
      });
    }

    const pregunta = await PreguntaSeguridad.findByIdAndDelete(id);

    if (!pregunta) {
      return res.status(404).json({ 
        success: false,
        message: 'Pregunta no encontrada' 
      });
    }

    res.json({
      success: true,
      message: 'Pregunta eliminada correctamente'
    });

  } catch (error) {
    console.error('❌ Error al eliminar pregunta:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error en el servidor' 
    });
  }
};

// ✅ Obtener la pregunta asignada a un usuario por email (lee desde la coleccion usuarios)
// GET /api/pregunta-seguridad?email=...
exports.obtenerPreguntaPorEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: 'email es requerido' });
    }
    const user = await Usuario.findOne({ email: String(email).toLowerCase().trim() }).lean();
    if (!user || !user.preguntaSeguridad || !user.preguntaSeguridad.pregunta) {
      return res.status(404).json({ success: false, message: 'No existe pregunta para este email' });
    }
    return res.json({ success: true, data: [{ _id: user.preguntaSeguridad._id || user._id, pregunta: user.preguntaSeguridad.pregunta }] });
  } catch (error) {
    console.error('❌ Error al obtener pregunta por email:', error);
    return res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
};

// ✅ Verificar respuesta de seguridad (contra hash almacenado en usuarios.preguntaSeguridad.respuesta)
// POST /api/pregunta-seguridad/verificar  { email, answers: { "<texto_pregunta>": "respuesta" } }
exports.verificarRespuesta = async (req, res) => {
  try {
    const { email, answers } = req.body || {};
    if (!email || !answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'email y answers son requeridos' });
    }
    const user = await Usuario.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !user.preguntaSeguridad || !user.preguntaSeguridad.pregunta || !user.preguntaSeguridad.respuesta) {
      return res.status(404).json({ success: false, message: 'No existe pregunta para este email' });
    }
    const keys = Object.keys(answers);
    if (keys.length === 0) return res.status(400).json({ success: false, message: 'answers vacío' });
    const preguntaTexto = keys[0];
    const respuestaPlano = String(answers[preguntaTexto] ?? '').trim();
    if (!respuestaPlano) return res.status(400).json({ success: false, message: 'Respuesta vacía' });
    if (preguntaTexto !== user.preguntaSeguridad.pregunta) {
      return res.status(400).json({ success: false, message: 'Pregunta no coincide' });
    }
    const ok = await bcrypt.compare(respuestaPlano, user.preguntaSeguridad.respuesta);
    if (!ok) return res.status(401).json({ success: false, message: 'Respuesta incorrecta' });

    // Opcional: emitir token corto para flujo de reset password
    // const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '15m' });
    return res.json({ success: true /*, token*/ });
  } catch (error) {
    console.error('❌ Error al verificar respuesta:', error);
    return res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
};
