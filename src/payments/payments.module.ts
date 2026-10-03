import { Module } from '@nestjs/common';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { BinLookupController } from './bin-lookup.controller';
import { MetodosPagoController } from './metodos-pago.controller';
import { MetodosPagoService } from './metodos-pago.service';

@Module({
  imports: [EcommerceModule],
  controllers: [BinLookupController, MetodosPagoController],
  providers: [MetodosPagoService],
  exports: [MetodosPagoService],
})
export class PaymentsModule {}
