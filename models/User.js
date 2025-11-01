const mongoose = require('mongoose');

// Esquema para la dirección
const DireccionSchema = new mongoose.Schema({
  calle: { type: String },
  numero: { type: String },
  colonia: { type: String },
  codigoPostal: { type: String },
  referencia: { type: String }
});

// Esquema para pregunta de seguridad
const PreguntaSeguridadSchema = new mongoose.Schema({
  pregunta: {
    type: String,
    required: [true, 'La pregunta es requerida'],
    trim: true
  },
  respuesta: {
    type: String,
    required: [true, 'La respuesta es requerida'],
    trim: true
  }
});

// Esquema para el perfil capilar
const PerfilCapilarSchema = new mongoose.Schema({
  tipoCabello: { 
    type: String, 
    enum: ['liso', 'ondulado', 'rizado', 'muy rizado', 'químico'],
    required: true
  },
  tieneAlergias: { type: Boolean, default: false },
  alergias: { type: String },
  tratamientosQuimicos: { type: Boolean, default: false },
  tratamientos: { type: String }
});

// Esquema principal de usuario
const UsuarioSchema = new mongoose.Schema({
  nombre: { 
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
  },
  telefono: { 
    type: String, 
    required: [true, 'El teléfono es requerido'],
    trim: true
  },
  password: { 
    type: String, 
    required: [true, 'La contraseña es requerida'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres']
  },
  fechaNacimiento: { 
    type: Date, 
    required: [true, 'La fecha de nacimiento es requerida']
  },
  preguntaSeguridad: {
    type: PreguntaSeguridadSchema,
    required: [true, 'La pregunta de seguridad es requerida']
  },
  direccion: { 
    type: DireccionSchema, 
    required: true 
  },
  perfilCapilar: { 
    type: PerfilCapilarSchema, 
    required: true 
  },
  aceptaAvisoPrivacidad: { 
    type: Boolean, 
    required: [true, 'Debes aceptar el aviso de privacidad'],
    default: false
  },
  recibePromociones: { 
    type: Boolean, 
    default: false 
  },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  creadoEn: { type: Date, default: Date.now },
  actualizadoEn: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'creadoEn', updatedAt: 'actualizadoEn' },
  versionKey: false
});

// Índices para mejorar búsquedas
UsuarioSchema.index({ email: 1 });
UsuarioSchema.index({ activo: 1 });

// Middleware pre-save para actualizar actualizadoEn
UsuarioSchema.pre('save', function(next) {
  this.actualizadoEn = new Date();
  next();
});

const Usuario = mongoose.model('Usuario', UsuarioSchema, 'usuarios');

module.exports = Usuario;
