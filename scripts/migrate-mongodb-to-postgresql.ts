/**
 * Script de migración de MongoDB a PostgreSQL
 * 
 * Ejecutar con: npx ts-node scripts/migrate-mongodb-to-postgresql.ts
 * 
 * Requisitos:
 * - Tener ambas bases de datos accesibles
 * - Configurar las variables de entorno necesarias
 */

import { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';

const prisma = new PrismaClient();

// Configuración de MongoDB (ajusta según tu caso)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://...';
const MONGODB_DB = process.env.MONGODB_DB || 'estetica-miru-franco';

async function migrateData() {
  const mongoClient = new MongoClient(MONGODB_URI);

  try {
    console.log('🔌 Conectando a MongoDB...');
    await mongoClient.connect();
    const db = mongoClient.db(MONGODB_DB);
    console.log('✅ Conectado a MongoDB');

    console.log('🔌 Conectando a PostgreSQL...');
    await prisma.$connect();
    console.log('✅ Conectado a PostgreSQL');

    // Migrar preguntas de seguridad (colección separada)
    console.log('\n📋 Migrando preguntas de seguridad...');
    const preguntasCollection = db.collection('pregunta-seguridad');
    const preguntasMongo = await preguntasCollection.find({}).toArray();
    
    // Estas preguntas ya estarán embebidas en usuarios, así que solo las registramos si es necesario
    console.log(`   Encontradas ${preguntasMongo.length} preguntas en colección separada`);
    console.log('   Nota: Las preguntas se migrarán junto con los usuarios');

    // Migrar usuarios
    console.log('\n👤 Migrando usuarios...');
    const usuariosCollection = db.collection('usuarios');
    const usuariosMongo = await usuariosCollection.find({}).toArray();
    
    console.log(`   Encontrados ${usuariosMongo.length} usuarios en MongoDB`);

    let usuariosMigrados = 0;
    let usuariosConError = 0;

    for (const usuarioMongo of usuariosMongo) {
      try {
        const preguntaSeguridad = usuarioMongo.preguntaSeguridad;
        const direccion = usuarioMongo.direccion;
        const perfilCapilar = usuarioMongo.perfilCapilar;

        // Crear usuario con relaciones
        await prisma.usuario.create({
          data: {
            nombre: usuarioMongo.nombre,
            email: usuarioMongo.email,
            telefono: usuarioMongo.telefono || null,
            password: usuarioMongo.password || null,
            fechaNacimiento: usuarioMongo.fechaNacimiento 
              ? new Date(usuarioMongo.fechaNacimiento.$date || usuarioMongo.fechaNacimiento)
              : null,
            googleId: usuarioMongo.googleId || null,
            foto: usuarioMongo.foto || null,
            aceptaAvisoPrivacidad: usuarioMongo.aceptaAvisoPrivacidad || false,
            recibePromociones: usuarioMongo.recibePromociones || false,
            resetPasswordToken: usuarioMongo.resetPasswordToken || null,
            resetPasswordExpires: usuarioMongo.resetPasswordExpires?.$date 
              ? new Date(usuarioMongo.resetPasswordExpires.$date)
              : usuarioMongo.resetPasswordExpires 
                ? new Date(usuarioMongo.resetPasswordExpires)
                : null,
            codigoOTP: usuarioMongo.codigoOTP || null,
            otpExpira: usuarioMongo.otpExpira?.$date
              ? new Date(usuarioMongo.otpExpira.$date)
              : usuarioMongo.otpExpira
                ? new Date(usuarioMongo.otpExpira)
                : null,
            confirmado: usuarioMongo.confirmado || false,
            creadoEn: usuarioMongo.creadoEn?.$date
              ? new Date(usuarioMongo.creadoEn.$date)
              : usuarioMongo.creadoEn
                ? new Date(usuarioMongo.creadoEn)
                : new Date(),
            actualizadoEn: usuarioMongo.actualizadoEn?.$date
              ? new Date(usuarioMongo.actualizadoEn.$date)
              : usuarioMongo.actualizadoEn
                ? new Date(usuarioMongo.actualizadoEn)
                : new Date(),
            activo: usuarioMongo.activo !== undefined ? usuarioMongo.activo : true,

            // Crear pregunta de seguridad si existe
            preguntaSeguridad: preguntaSeguridad
              ? {
                  create: {
                    pregunta: preguntaSeguridad.pregunta,
                    respuesta: preguntaSeguridad.respuesta,
                  },
                }
              : undefined,

            // Crear dirección si existe
            direccion: direccion
              ? {
                  create: {
                    calle: direccion.calle || null,
                    numero: direccion.numero || null,
                    colonia: direccion.colonia || null,
                    ciudad: direccion.ciudad || null,
                    estado: direccion.estado || null,
                    codigoPostal: direccion.codigoPostal || null,
                  },
                }
              : undefined,

            // Crear perfil capilar si existe
            perfilCapilar: perfilCapilar
              ? {
                  create: {
                    tipoCabello: perfilCapilar.tipoCabello || null,
                    colorNatural: perfilCapilar.colorNatural || null,
                    colorActual: perfilCapilar.colorActual || null,
                    productosUsados: perfilCapilar.productosUsados || null,
                    alergias: perfilCapilar.alergias || perfilCapilar.tieneAlergias 
                      ? (perfilCapilar.tieneAlergias ? 'Sí' : 'No') 
                      : null,
                  },
                }
              : undefined,
          },
        });

        usuariosMigrados++;
        console.log(`   ✅ Usuario migrado: ${usuarioMongo.email} (${usuariosMigrados}/${usuariosMongo.length})`);

      } catch (error: any) {
        usuariosConError++;
        console.error(
          '   ❌ Error migrando usuario:',
          usuarioMongo.email,
          error?.message ?? error,
        );
        
        // Si el error es por duplicado (email ya existe), continuar
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
          console.log(`   ⚠️  Usuario ${usuarioMongo.email} ya existe en PostgreSQL, saltando...`);
        }
      }
    }

    console.log('\n📊 Resumen de migración:');
    console.log(`   ✅ Usuarios migrados: ${usuariosMigrados}`);
    console.log(`   ❌ Usuarios con error: ${usuariosConError}`);
    console.log(`   📋 Total procesados: ${usuariosMongo.length}`);

  } catch (error) {
    console.error('❌ Error en la migración:', error);
    throw error;
  } finally {
    await mongoClient.close();
    await prisma.$disconnect();
    console.log('\n🔌 Conexiones cerradas');
  }
}

// Ejecutar migración
migrateData()
  .then(() => {
    console.log('\n✅ Migración completada exitosamente');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal en la migración:', error);
    process.exit(1);
  });

