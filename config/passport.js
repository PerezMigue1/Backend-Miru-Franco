const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Usuario = require('../models/User');
const jwt = require('jsonwebtoken');

// Configurar Passport con Google Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Buscar usuario por email o googleId
      const email = profile.emails[0].value.toLowerCase();
      let usuario = await Usuario.findOne({ 
        $or: [
          { email: email },
          { googleId: profile.id }
        ]
      });
      
      if (!usuario) {
        // Crear nuevo usuario con Google
        usuario = new Usuario({
          nombre: profile.displayName,
          email: profile.emails[0].value.toLowerCase(),
          googleId: profile.id,
          foto: profile.photos[0]?.value || null,
          telefono: null, // No requerido para usuarios de Google
          password: null, // No requiere contraseña para usuarios de Google
          fechaNacimiento: null, // Se puede completar después
          preguntaSeguridad: null, // No requerido para usuarios de Google
          direccion: null, // Se puede completar después
          perfilCapilar: null, // Se puede completar después
          aceptaAvisoPrivacidad: true, // True por defecto para usuarios de Google
          recibePromociones: false,
          activo: true
        });
        
        await usuario.save();
      } else {
        // Actualizar Google ID y foto si no existen
        if (!usuario.googleId) {
          usuario.googleId = profile.id;
        }
        if (!usuario.foto && profile.photos[0]?.value) {
          usuario.foto = profile.photos[0].value;
        }
        await usuario.save();
      }
      
      return done(null, usuario);
    } catch (error) {
      console.error('Error en Google Strategy:', error);
      return done(error, null);
    }
  }
));

// Serializar usuario para la sesión (si usas sesiones)
passport.serializeUser((usuario, done) => {
  done(null, usuario._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const usuario = await Usuario.findById(id);
    done(null, usuario);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;

