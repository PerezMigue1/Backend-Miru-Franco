const mongoose = require('mongoose');

const PreguntaSeguridadSchema = new mongoose.Schema({
  pregunta: {
    type: String,
    required: [true, 'La pregunta es requerida'],
    trim: true
  }
}, {
  versionKey: false
});

const PreguntaSeguridad = mongoose.model('PreguntaSeguridad', PreguntaSeguridadSchema, 'pregunta-seguridad');

module.exports = PreguntaSeguridad;
