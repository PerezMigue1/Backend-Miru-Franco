import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { PrismaModule } from './prisma/prisma.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { AuthModule } from './auth/auth.module';
import { PreguntaSeguridadModule } from './pregunta-seguridad/pregunta-seguridad.module';
import { EmailModule } from './email/email.module';
import { SecurityModule } from './common/services/security.module';
import { ProductosModule } from './productos/productos.module';
import { ServiciosModule } from './servicios/servicios.module';
import { PaquetesModule } from './paquetes/paquetes.module';
import { DbModule } from './db/db.module';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { PaymentsModule } from './payments/payments.module';
import { InventarioModule } from './inventario/inventario.module';
import { EmpleadosModule } from './empleados/empleados.module';
import { PermisosModule } from './permisos/permisos.module';
import { ClientesModule } from './clientes/clientes.module';
import { QuejasModule } from './quejas/quejas.module';
import { SeguimientosModule } from './seguimientos/seguimientos.module';
import { CitasModule } from './citas/citas.module';
import { PosModule } from './pos/pos.module';
import { OauthModule } from './oauth/oauth.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { ComprasModule } from './compras/compras.module';
import { CotizacionesModule } from './cotizaciones/cotizaciones.module';
import { ReportesModule } from './reportes/reportes.module';
import { RecomendacionesModule } from './recomendaciones/recomendaciones.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuración global
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [databaseConfig],
      cache: true,
    }),
    // Módulos de base de datos
    PrismaModule,
    // Módulos de seguridad
    SecurityModule,
    // Módulos de funcionalidad
    EmailModule,
    UsuariosModule,
    AuthModule,
    PreguntaSeguridadModule,
    ProductosModule,
    ServiciosModule,
    PaquetesModule,
    ProveedoresModule,
    ComprasModule,
    CotizacionesModule,
    ReportesModule,
    DbModule,
    EcommerceModule,
    PaymentsModule,
    InventarioModule,
    EmpleadosModule,
    PermisosModule,
    ClientesModule,
    QuejasModule,
    SeguimientosModule,
    CitasModule,
    PosModule,
    OauthModule,
    RecomendacionesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

