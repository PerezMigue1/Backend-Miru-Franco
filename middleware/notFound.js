// Middleware para manejo de rutas no encontradas
const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: `Ruta ${req.originalUrl} no encontrada`
  });
};

module.exports = notFound;

