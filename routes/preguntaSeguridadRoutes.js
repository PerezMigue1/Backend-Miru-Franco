const express = require('express');
const router = express.Router();
const preguntaSeguridadController = require('../controllers/preguntaSeguridadController');

// Obtener pregunta por email (si viene query.email) o listado completo
router.get('/', (req, res, next) => {
    if (req.query && req.query.email) {
        return preguntaSeguridadController.obtenerPreguntaPorEmail(req, res);
    }
    return preguntaSeguridadController.obtenerPreguntas(req, res);
});
router.get('/:id', preguntaSeguridadController.obtenerPorId);
router.post('/', preguntaSeguridadController.crearPregunta);
router.post('/verificar', preguntaSeguridadController.verificarRespuesta);
router.put('/:id', preguntaSeguridadController.actualizarPregunta);
router.delete('/:id', preguntaSeguridadController.eliminarPregunta);

module.exports = router;