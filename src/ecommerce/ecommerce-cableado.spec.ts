import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { DevolucionesService } from './devoluciones/devoluciones.service';
import { EcommerceModule } from './ecommerce.module';
import { MercadoPagoClient } from './mercadopago/mercadopago.client';
import { PedidosService } from './pedidos/pedidos.service';

/**
 * Cableado real de EcommerceModule: PedidosService recibe DevolucionesService y este recibe MercadoPagoClient.
 * Las dos inyecciones son @Optional(): si el cableado se rompe (otro módulo, un token distinto o un tipo que
 * TypeScript emite como Object), Nest inyecta undefined sin avisar y el reembolso automático de la revocación
 * deja de salir en silencio (queda "en_revision" o responde 503). Esta prueba lo detecta.
 */
describe('EcommerceModule: cableado de la revocación y el reembolso automático', () => {
  it('compila el módulo y PedidosService → DevolucionesService → MercadoPagoClient son las instancias del contenedor', async () => {
    const modulo = await Test.createTestingModule({
      // Como en AppModule: ConfigModule global (sin leer .env) y el bus de eventos.
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EventEmitterModule.forRoot(), EcommerceModule],
    })
      // Sin base de datos: compile() solo construye los providers (no llama onModuleInit).
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    try {
      // Las instancias de EcommerceModule (AnticiposModule tiene su propio MercadoPagoClient).
      const ecommerce = modulo.select(EcommerceModule);
      const pedidos = ecommerce.get(PedidosService, { strict: true });
      const devoluciones = ecommerce.get(DevolucionesService, { strict: true });
      const mercadoPago = ecommerce.get(MercadoPagoClient, { strict: true });

      expect((pedidos as unknown as { devoluciones?: unknown }).devoluciones).toBeInstanceOf(DevolucionesService);
      expect((pedidos as unknown as { devoluciones?: unknown }).devoluciones).toBe(devoluciones);
      expect((devoluciones as unknown as { mercadoPago?: unknown }).mercadoPago).toBeInstanceOf(MercadoPagoClient);
      expect((devoluciones as unknown as { mercadoPago?: unknown }).mercadoPago).toBe(mercadoPago);
    } finally {
      await modulo.close();
    }
  });
});
