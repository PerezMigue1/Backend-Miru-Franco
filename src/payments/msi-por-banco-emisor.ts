/**
 * Indicio de MSI según el nombre del emisor devuelto por BIN u heurística local.
 * No sustituye a la pasarela de pago; es orientativo para el resumen del checkout.
 */
export type IndicioMsiEmisor = 'probable' | 'sin_indicio';

/** Coincide con nombres típicos de emisores MX (y algunas variantes en inglés) con programas MSI habituales en retail. */
const EMISOR_CON_MSI_PROBABLE =
  /bbva|banco\s*invex|santander|banamex|citibanamex|\bciti\b|banco\s*nacional\s*de\s*m[eé]xico|banorte|\bixe\b|hsbc|scotiabank|scotia|inbursa|afirme|bancoppel|banco\s*azteca|elektra|american\s*express|\bamex\b|nu\s*bank|nubank|banregio|mifel|monex|actinver|multiva|banbaj[ií]o|bansi|sabadell|hey\s*banco|compartamos\s*banco|falabella|ripley|mercado\s*pago|banjercito|inter\s*banco|banco\s*del\s*baj[ií]o|volkswagen\s*bank|bmw\s*financial|gm\s*financial/i;

export function indicioMsiPorBancoEmisor(bancoEmisor: string | null | undefined): IndicioMsiEmisor {
  const b = (bancoEmisor ?? '').trim();
  if (!b || /no\s+identificado/i.test(b)) {
    return 'sin_indicio';
  }
  return EMISOR_CON_MSI_PROBABLE.test(b) ? 'probable' : 'sin_indicio';
}
