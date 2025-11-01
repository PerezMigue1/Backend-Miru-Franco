// api/index.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(express.json());

// Configura CORS interno (aunque Vercel ya lo hará por headers)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rutas
app.use('/api/usuarios', require('./routes/usuario.routes'));
app.use('/api/preguntas', require('./routes/pregunta.routes'));
app.use('/api/productos', require('./routes/producto.routes')); 
app.use('/api/categoriaProducto', require('./routes/categoriaProducto.routes'))
app.use('/api/hospedaje', require('./routes/hospedaje.routes'));
app.use('/api/lugares', require('./routes/lugarTuristico.route'));
app.use("/api/artesano", require('./routes/contactoArtesano.routes'));
app.use("/api/contacto", require("./routes/contactoForm.routes"));
app.use("/api/publicaciones", require('./routes/productoRevision.routes'));
app.use('/api/notificaciones', require('./routes/notificacion.routes'));
app.use('/api/gastronomia', require('./routes/gastronomia.routes'));
app.use('/api/contactoHospedero', require('./routes/contactoHospedero.routes'));
app.use('/api/publicaHospedaje', require('./routes/publicacionHospedaje.routes'));
app.use('/api/contactoChef', require('./routes/contactoChef.routes'));
app.use('/api/publicacionGastronomia', require('./routes/publicacionGastronomia.routes'));
app.use('/api/contactoRestaurante', require('./routes/contactoRestaurante.routes'));
app.use('/api/festividades', require('./routes/festividades.routes'));
app.use('/api/publicaRestaurantes', require('./routes/publicacionRestaurante.routes'));
app.use('/api/comidaRestaurante', require('./routes/comidaRestaurante.routes'));
app.use('/api/restaurante', require('./routes/restaurante.routes'));
app.use('/api/negocios', require('./routes/negocio.routes'));
app.use('/api/misionvision', require('./routes/misionVision.routes'));
app.use('/api/politicas', require('./routes/politicas.routes'));
app.use('/api/faq', require('./routes/faq.routes'));
app.use('/api/ecoturismo', require('./routes/ecoturismo.routes'));
app.use('/api/encuestas', require('./routes/encuesta.routes'));

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("✅ MongoDB conectado"))
    .catch(err => console.error("❌ Error al conectar MongoDB:", err));

// Ruta root
app.get('/', (req, res) => {
    res.send({ mensaje: 'API funcionando' });
});

module.exports = app;

// Iniciar servidor (solo en desarrollo local)
const port = process.env.PORT || 3001;
if (require.main === module) {
    app.listen(port, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
    });
};