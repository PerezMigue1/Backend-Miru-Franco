const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/userController');

// CRUD básico
router.get('/', usuarioController.obtenerUsuarios);
router.get('/:id', usuarioController.obtenerUsuarioPorId);
router.post('/', usuarioController.crearUsuario);
router.post('/registrar', usuarioController.crearUsuario); // Alias para compatibilidad con frontend
router.put('/:id', usuarioController.actualizarUsuario);
router.delete('/:id', usuarioController.eliminarUsuario);

// Autenticación
router.post('/login', usuarioController.loginUsuario);

// Verificación OTP
router.post('/verificar-otp', usuarioController.verificarOTP);
router.post('/reenviar-codigo', usuarioController.reenviarCodigo);

// Recuperación de contraseña
router.post('/pregunta-seguridad', usuarioController.obtenerPreguntaSeguridad);
router.post('/verificar-respuesta', usuarioController.validarRespuestaSeguridad);
router.post('/cambiar-password', usuarioController.cambiarPassword);

// Perfil de usuario
router.get('/:id/perfil', usuarioController.obtenerPerfilUsuario);
router.put('/:id/perfil', usuarioController.actualizarPerfilUsuario);
router.put('/:id/cambiar-password', usuarioController.cambiarPasswordDesdePerfil);

module.exports = router;
