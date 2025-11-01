const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Opciones de conexión recomendadas
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
      // Estas opciones ya no son necesarias en versiones recientes de Mongoose
    });

    console.log(`✅ MongoDB conectado: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error de conexión a MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Manejo de eventos de conexión
mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB desconectado');
});

mongoose.connection.on('error', (err) => {
  console.error(`❌ Error de MongoDB: ${err.message}`);
});

module.exports = connectDB;

