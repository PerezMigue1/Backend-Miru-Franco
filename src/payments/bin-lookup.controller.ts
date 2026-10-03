import { Controller, Get, GoneException, Query } from '@nestjs/common';
import { indicioMsiPorBancoEmisor } from './msi-por-banco-emisor';

@Controller('payments')
export class BinLookupController {
  /**
   * Retirado: con Mercado Pago Checkout Pro la tarjeta se escribe en la página de Mercado Pago y el
   * sitio no recibe dígitos de tarjeta. Ya no se consulta a servicios externos de BIN.
   */
  @Get('bin-lookup')
  binLookup() {
    throw new GoneException('La consulta de tarjetas ya no está disponible.');
  }

  /**
   * Solo heurística MSI por nombre de emisor (sin llamar APIs externas).
   * GET /api/payments/msi-indicio?bancoEmisor=BBVA
   */
  @Get('msi-indicio')
  msiIndicio(@Query('bancoEmisor') bancoEmisor: string) {
    return { indicioMsi: indicioMsiPorBancoEmisor(bancoEmisor) };
  }
}
