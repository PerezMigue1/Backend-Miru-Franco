const mongoose = require('mongoose');

const bcrypt = require('bcryptjs');

const PreguntaSeguridadSchema = new mongoose.Schema({
  // Catálogo o pregunta asignada al usuario
  pregunta: {
    type: String,
    required: [true, 'La pregunta es requerida'],
    trim: true
  },
  // Email del usuario al que se le asignó esta pregunta (si aplica)
  email: {
    type: String,
    trim: true,
    lowercase: true,
    index: true,
    default: null
  },
  // Respuesta hasheada (solo cuando es una pregunta asignada a un usuario)
  respuestaHash: {
    type: String,
    default: null
  }
}, {
  versionKey: false
});

PreguntaSeguridadSchema.methods.setRespuesta = async function(respuestaPlano) {
  const salt = await bcrypt.genSalt(10);
  this.respuestaHash = await bcrypt.hash(String(respuestaPlano), salt);
};

PreguntaSeguridadSchema.methods.verificarRespuesta = async function(respuestaPlano) {
  if (!this.respuestaHash) return false;
  return bcrypt.compare(String(respuestaPlano), this.respuestaHash);
};

const PreguntaSeguridad = mongoose.model('PreguntaSeguridad', PreguntaSeguridadSchema, 'pregunta-seguridad');

module.exports = PreguntaSeguridad;
