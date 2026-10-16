import { lastValueFrom, of, throwError } from 'rxjs';
import { avisarRevalidacionWeb, destinoRevalidacion, revalidarWebAhora, RevalidarWebInterceptor } from './revalidacion-web';

/** Revalidación inmediata de la web al guardar contenido público (la caché de 60 s queda de respaldo). */
const SECRETO_PRUEBA = 'x'.repeat(40);

describe('Revalidación inmediata de la web', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://web.prueba/';
    process.env.REVALIDAR_SECRETO = SECRETO_PRUEBA;
  });
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });

  it('sin FRONTEND_URL o con un secreto corto no se avisa (queda la caché de 60 s)', async () => {
    process.env.REVALIDAR_SECRETO = 'corto';
    expect(destinoRevalidacion()).toBeNull();
    const f = jest.fn();
    await expect(revalidarWebAhora(f as unknown as typeof fetch)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('manda POST a /api/revalidar con el secreto en un encabezado (nunca en la URL)', async () => {
    const f = jest.fn(async () => ({ ok: true, status: 200 }));
    await expect(revalidarWebAhora(f as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = (f.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('https://web.prueba/api/revalidar');
    expect(url).not.toContain(SECRETO_PRUEBA);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-revalidar-secreto']).toBe(SECRETO_PRUEBA);
  });

  it('si la web no responde, no lanza', async () => {
    const f = jest.fn(async () => {
      throw new Error('sin red');
    });
    await expect(revalidarWebAhora(f as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('varios guardados seguidos se avisan una sola vez', async () => {
    jest.useFakeTimers();
    const f = jest.fn(async () => ({ ok: true, status: 200 }));
    const original = global.fetch;
    global.fetch = f as unknown as typeof fetch;
    try {
      avisarRevalidacionWeb();
      avisarRevalidacionWeb();
      avisarRevalidacionWeb();
      await jest.advanceTimersByTimeAsync(1500);
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });

  describe('Interceptor', () => {
    const contexto = (method: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method }) }) }) as never;

    it('avisa después de un guardado correcto, no en GET ni si el guardado falla', async () => {
      jest.useFakeTimers();
      const f = jest.fn(async () => ({ ok: true, status: 200 }));
      const original = global.fetch;
      global.fetch = f as unknown as typeof fetch;
      try {
        const i = new RevalidarWebInterceptor();
        await lastValueFrom(i.intercept(contexto('GET'), { handle: () => of(1) }));
        await jest.advanceTimersByTimeAsync(1500);
        expect(f).not.toHaveBeenCalled();
        await expect(lastValueFrom(i.intercept(contexto('PUT'), { handle: () => throwError(() => new Error('400')) }))).rejects.toThrow('400');
        await jest.advanceTimersByTimeAsync(1500);
        expect(f).not.toHaveBeenCalled();
        await lastValueFrom(i.intercept(contexto('PUT'), { handle: () => of({ success: true }) }));
        await jest.advanceTimersByTimeAsync(1500);
        expect(f).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = original;
      }
    });
  });
});
