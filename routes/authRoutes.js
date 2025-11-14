const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const usuarioController = require('../controllers/userController');
const router = express.Router();

// Ruta para iniciar autenticación con Google
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Callback de Google OAuth
router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const usuario = req.user;
      
      if (!usuario) {
        throw new Error('Usuario no encontrado');
      }

      // Generar token JWT
      const token = jwt.sign(
        { id: usuario._id, email: usuario.email },
        process.env.JWT_SECRET || 'tu_secreto_temporal',
        { expiresIn: '7d' }
      );
      
      // Redirigir al frontend con el token
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${token}&success=true`);
      
    } catch (error) {
      console.error('Error en callback de Google:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?error=authentication_failed`);
    }
  }
);

// Ruta para obtener información del usuario autenticado (opcional)
router.get('/me', 
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          success: false,
          message: 'Token no proporcionado' 
        });
      }

      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tu_secreto_temporal');
      
      const Usuario = require('../models/User');
      const usuario = await Usuario.findById(decoded.id).select('-password -resetPasswordToken');
      
      if (!usuario) {
        return res.status(404).json({ 
          success: false,
          message: 'Usuario no encontrado' 
        });
      }

      // Ocultar respuesta de preguntaSeguridad si existe
      const usuarioObj = usuario.toObject();
      if (usuarioObj.preguntaSeguridad && usuarioObj.preguntaSeguridad.respuesta) {
        delete usuarioObj.preguntaSeguridad.respuesta;
      }

      res.json({
        success: true,
        data: usuarioObj
      });
    } catch (error) {
      console.error('Error al obtener usuario:', error);
      res.status(401).json({ 
        success: false,
        message: 'Token inválido' 
      });
    }
  }
);

// 🔹 Verificar si un correo ya está registrado (validación en tiempo real)
router.post('/verificar-correo', usuarioController.verificarCorreoExistente);

module.exports = router;

