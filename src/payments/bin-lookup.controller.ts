import { Controller, Get, Query } from '@nestjs/common';
import { BinLookupService } from './bin-lookup.service';
import { indicioMsiPorBancoEmisor } from './msi-por-banco-emisor';

@Controller('payments')
export class BinLookupController {
  constructor(private readonly binLookupService: BinLookupService) {}

  /**
   * Consulta BIN (binlist + respaldo). Respuesta incluye indicioMsi (heurística MSI por nombre de banco).
   * GET /api/payments/bin-lookup?bin=4242424242424242
   */
  @Get('bin-lookup')
  async binLookup(@Query('bin') bin: string) {
    return this.binLookupService.lookup(bin ?? '');
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
