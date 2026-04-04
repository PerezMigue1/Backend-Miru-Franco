import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { indicioMsiPorBancoEmisor } from './msi-por-banco-emisor';

/**
 * Consulta BIN/IIN: primero lookup.binlist.net; si está saturado (429), se usa
 * respaldo (mrchecker.live API pública). Caché en memoria por BIN de 8 dígitos.
 */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const MAX_CACHE_ENTRIES = 2000;

type CachedPayload = Record<string, unknown>;

type BinlistInput = {
  scheme?: string;
  type?: string;
  brand?: string;
  bank?: { name?: string };
  country?: { name?: string; alpha2?: string };
  prepaid?: boolean;
};

@Injectable()
export class BinLookupService {
  private readonly binResponseCache = new Map<string, { expires: number; body: CachedPayload }>();

  private cacheGet(binKey: string): CachedPayload | null {
    const row = this.binResponseCache.get(binKey);
    if (!row || Date.now() > row.expires) {
      if (row) this.binResponseCache.delete(binKey);
      return null;
    }
    return row.body;
  }

  private cacheSet(binKey: string, body: CachedPayload) {
    while (this.binResponseCache.size >= MAX_CACHE_ENTRIES) {
      const first = this.binResponseCache.keys().next().value as string | undefined;
      if (first) this.binResponseCache.delete(first);
      else break;
    }
    this.binResponseCache.set(binKey, { expires: Date.now() + CACHE_TTL_MS, body });
  }

  private normalizeScheme(s: string | undefined | null): string | null {
    if (!s || typeof s !== 'string') return null;
    const t = s.trim();
    return t ? t.toLowerCase() : null;
  }

  private bodyFromBinlist(data: BinlistInput): CachedPayload {
    const rawType = String(data.type ?? '').toLowerCase();
    const isPrepaid = Boolean(data.prepaid);

    let cardKind: 'credit' | 'debit' | 'prepaid' | 'unknown' = 'unknown';
    if (isPrepaid) {
      cardKind = 'prepaid';
    } else if (rawType === 'credit') {
      cardKind = 'credit';
    } else if (rawType === 'debit') {
      cardKind = 'debit';
    }

    let paymentCategory: 'credito' | 'debito' | null = null;
    if (rawType === 'credit') {
      paymentCategory = 'credito';
    } else if (rawType === 'debit') {
      paymentCategory = 'debito';
    }

    const bankName = data.bank?.name?.trim() || null;

    return {
      scheme: this.normalizeScheme(data.scheme),
      brand: data.brand ?? null,
      bankName,
      country: data.country?.name ?? data.country?.alpha2 ?? null,
      cardKind,
      paymentCategory,
      rawType: data.type ?? null,
      prepaid: isPrepaid,
      lookupSource: 'binlist',
      indicioMsi: indicioMsiPorBancoEmisor(bankName),
    };
  }

  private async fetchFromBinlist(binKey: string): Promise<Response> {
    return fetch(`https://lookup.binlist.net/${binKey}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'miru-backend/1.0 (checkout BIN lookup)',
      },
      cache: 'no-store',
    } as RequestInit);
  }

  /** Respaldo cuando binlist responde 429. Suele tardar ~2–3 s; a veces no incluye banco. */
  private async fetchFromMrCheckerFallback(binKey: string): Promise<CachedPayload | null> {
    const bin6 = binKey.slice(0, 6);
    try {
      const res = await fetch(
        `https://mrchecker.live/api/public/bin-lookup.php?bin=${encodeURIComponent(bin6)}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'miru-backend/1.0 (checkout BIN fallback)',
          },
          cache: 'no-store',
        } as RequestInit,
      );
      if (!res.ok) return null;
      const j = (await res.json()) as {
        success?: boolean;
        data?: {
          scheme?: string;
          type?: string;
          brand?: string;
          country?: string;
          bank?: string;
          issuer?: string;
        };
      };
      if (!j.success || !j.data) return null;

      const d = j.data;
      const rawType = String(d.type ?? '').toLowerCase();
      const isCredit = rawType === 'credit';
      const isDebit = rawType === 'debit';

      let cardKind: 'credit' | 'debit' | 'prepaid' | 'unknown' = 'unknown';
      if (isCredit) cardKind = 'credit';
      else if (isDebit) cardKind = 'debit';

      let paymentCategory: 'credito' | 'debito' | null = null;
      if (isCredit) paymentCategory = 'credito';
      else if (isDebit) paymentCategory = 'debito';

      const bankName =
        (typeof d.bank === 'string' && d.bank.trim()) ||
        (typeof d.issuer === 'string' && d.issuer.trim()) ||
        null;

      return {
        scheme: this.normalizeScheme(d.scheme),
        brand: d.brand?.trim() || null,
        bankName,
        country: d.country?.trim() || null,
        cardKind,
        paymentCategory,
        rawType: d.type ?? null,
        prepaid: false,
        lookupSource: 'mrchecker',
        indicioMsi: indicioMsiPorBancoEmisor(bankName),
      };
    } catch {
      return null;
    }
  }

  async lookup(binRaw: string): Promise<CachedPayload> {
    const bin = (binRaw ?? '').replace(/\D/g, '');
    if (bin.length < 6 || bin.length > 19) {
      throw new HttpException(
        { error: 'Indica al menos 6 dígitos del número de tarjeta.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const binKey = bin.slice(0, 8);

    const cached = this.cacheGet(binKey);
    if (cached) {
      return cached;
    }

    try {
      let res = await this.fetchFromBinlist(binKey);

      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await this.fetchFromBinlist(binKey);
      }

      if (res.ok) {
        const data = (await res.json()) as BinlistInput;
        const body = this.bodyFromBinlist(data);
        this.cacheSet(binKey, body);
        return body;
      }

      const tryFallback = res.status === 429 || res.status >= 500;
      if (tryFallback) {
        const fallbackBody = await this.fetchFromMrCheckerFallback(binKey);
        if (fallbackBody) {
          if (!fallbackBody.paymentCategory) {
            throw new HttpException(
              {
                error: 'No pudimos confirmar el tipo de tarjeta. Intenta de nuevo en unos momentos.',
              },
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          }
          this.cacheSet(binKey, fallbackBody);
          return fallbackBody;
        }
      }

      if (res.status === 429) {
        throw new HttpException(
          {
            error: 'El verificador está ocupado. Espera un minuto e intenta de nuevo.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new HttpException(
        { error: 'No pudimos verificar la tarjeta. Revisa el número e intenta de nuevo.' },
        HttpStatus.BAD_GATEWAY,
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const fallbackBody = await this.fetchFromMrCheckerFallback(binKey);
      if (fallbackBody?.paymentCategory) {
        this.cacheSet(binKey, fallbackBody);
        return fallbackBody;
      }
      throw new HttpException(
        { error: 'Error de conexión al verificar la tarjeta.' },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
