const express = require('express');
const router = express.Router();
const recuperarPasswordController = require('../controllers/recuperarPasswordController');

// CRUD básico
router.get('/', recuperarPasswordController.obtenerSolicitudes);
router.get('/token/:token', recuperarPasswordController.obtenerPorToken);
router.get('/email/:email', recuperarPasswordController.obtenerPorEmail);
router.post('/', recuperarPasswordController.crearSolicitud);
router.delete('/:id', recuperarPasswordController.eliminarSolicitud);

// Operaciones específicas
router.post('/validar', recuperarPasswordController.validarToken);
router.post('/marcar-usado', recuperarPasswordController.marcarComoUsado);

module.exports = router;

