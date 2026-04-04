import { Module } from '@nestjs/common';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { BinLookupController } from './bin-lookup.controller';
import { BinLookupService } from './bin-lookup.service';
import { MetodosPagoController } from './metodos-pago.controller';
import { MetodosPagoService } from './metodos-pago.service';

@Module({
  imports: [EcommerceModule],
  controllers: [BinLookupController, MetodosPagoController],
  providers: [BinLookupService, MetodosPagoService],
  exports: [BinLookupService, MetodosPagoService],
})
export class PaymentsModule {}
