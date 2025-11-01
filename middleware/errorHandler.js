// Middleware para manejo centralizado de errores
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Error de validación
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  // Error de no autorizado
  if (err.status === 401) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado'
    });
  }

  // Error genérico
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Error interno del servidor'
  });
};

module.exports = errorHandler;

