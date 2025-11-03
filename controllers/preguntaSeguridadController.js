const PreguntaSeguridad = require('../models/PreguntaSeguridad');

// ✅ Obtener todas las preguntas de seguridad
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
    const { pregunta } = req.body;

    if (!pregunta || !pregunta.trim()) {
      return res.status(400).json({ 
        success: false,
        message: 'La pregunta es requerida' 
      });
    }

    const nuevaPregunta = new PreguntaSeguridad({
      pregunta: pregunta.trim()
    });

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
    const { pregunta } = req.body;

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

    const preguntaActualizada = await PreguntaSeguridad.findByIdAndUpdate(
      id,
      { pregunta: pregunta.trim() },
      { new: true, runValidators: true }
    );

    if (!preguntaActualizada) {
      return res.status(404).json({ 
        success: false,
        message: 'Pregunta no encontrada' 
      });
    }

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
