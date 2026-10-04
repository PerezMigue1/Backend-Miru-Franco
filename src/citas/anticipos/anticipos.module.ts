import { Module } from '@nestjs/common';
import { MercadoPagoClient } from '../../ecommerce/mercadopago/mercadopago.client';
import { AnticiposCitasController } from './anticipos-citas.controller';
import { AnticiposCitasService } from './anticipos-citas.service';
import { AnticiposBarridaService } from './anticipos-barrida.service';

/** Anticipos de citas. Lo importa EcommerceModule para que el webhook de Mercado Pago aplique pagos de citas. */
@Module({
  controllers: [AnticiposCitasController],
  providers: [AnticiposCitasService, AnticiposBarridaService, MercadoPagoClient],
  exports: [AnticiposCitasService],
})
export class AnticiposModule {}
