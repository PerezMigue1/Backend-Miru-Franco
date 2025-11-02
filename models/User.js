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
    required: function() { return !this.googleId; }, // Requerido solo si no es usuario de Google
    trim: true
  },
  password: { 
    type: String, 
    required: function() { return !this.googleId; }, // Requerido solo si no es usuario de Google
    validate: {
      validator: function(v) {
        // Si es usuario de Google, no validar
        if (this.googleId) return true;
        // Si no es usuario de Google, debe tener al menos 6 caracteres
        return !v || v.length >= 6;
      },
      message: 'La contraseña debe tener al menos 6 caracteres'
    }
  },
  fechaNacimiento: { 
    type: Date, 
    required: function() { return !this.googleId; } // Requerido solo si no es usuario de Google
  },
  preguntaSeguridad: {
    type: PreguntaSeguridadSchema,
    required: function() { return !this.googleId; } // Requerido solo si no es usuario de Google
  },
  direccion: { 
    type: DireccionSchema, 
    required: function() { return !this.googleId; } // Requerido solo si no es usuario de Google
  },
  perfilCapilar: { 
    type: PerfilCapilarSchema, 
    required: function() { return !this.googleId; } // Requerido solo si no es usuario de Google
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Permite múltiples documentos sin googleId
  },
  foto: {
    type: String
  },
  aceptaAvisoPrivacidad: { 
    type: Boolean, 
    required: function() { return !this.googleId; }, // Requerido solo si no es usuario de Google
    default: function() { return !!this.googleId; } // True por defecto para usuarios de Google
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
