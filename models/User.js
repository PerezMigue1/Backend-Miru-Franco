const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre es requerido'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'El email es requerido'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Por favor ingresa un email válido']
  }
}, {
  timestamps: true,
  versionKey: false
});

// Agregar índice para mejorar búsquedas por email
userSchema.index({ email: 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
