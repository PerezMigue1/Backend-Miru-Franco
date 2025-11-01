const express = require('express');
const router = express.Router();
const preguntaSeguridadController = require('../controllers/preguntaSeguridadController');

// CRUD básico
router.get('/', preguntaSeguridadController.obtenerPreguntas);
router.get('/:id', preguntaSeguridadController.obtenerPorId);
router.post('/', preguntaSeguridadController.crearPregunta);
router.put('/:id', preguntaSeguridadController.actualizarPregunta);
router.delete('/:id', preguntaSeguridadController.eliminarPregunta);

module.exports = router;
