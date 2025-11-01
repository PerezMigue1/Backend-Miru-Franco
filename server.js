const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configura CORS interno (aunque Vercel ya lo hará por headers)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('dev'));

// Rutas
// En Vercel, api/index.js se monta en /api, así que usamos /users
// En local, usamos /api/users
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;
app.use(isVercel ? '/users' : '/api/users', require('./routes/userRoutes'));

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
}
