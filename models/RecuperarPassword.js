const mongoose = require('mongoose');

const RecuperarPasswordSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'El email es requerido'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Por favor ingresa un email válido']
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  fechaExpiracion: {
    type: Date,
    required: true,
    default: () => Date.now() + 15 * 60 * 1000 // 15 minutos por defecto
  },
  usado: {
    type: Boolean,
    default: false
  },
  creadoEn: {
    type: Date,
    default: Date.now
  },
  actualizadoEn: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'creadoEn', updatedAt: 'actualizadoEn' },
  versionKey: false
});

// Índices para mejorar búsquedas
RecuperarPasswordSchema.index({ email: 1 });
RecuperarPasswordSchema.index({ token: 1 });
RecuperarPasswordSchema.index({ fechaExpiracion: 1 }, { expireAfterSeconds: 0 });

// Middleware pre-save para actualizar actualizadoEn
RecuperarPasswordSchema.pre('save', function(next) {
  this.actualizadoEn = new Date();
  next();
});

const RecuperarPassword = mongoose.model('RecuperarPassword', RecuperarPasswordSchema, 'recuperar-password');

module.exports = RecuperarPassword;

