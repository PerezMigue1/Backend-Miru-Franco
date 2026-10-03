import { ExportDirectService } from './export-direct.service';

const PREFIJO = /^BEGIN; SET LOCAL statement_timeout = \d+;\n/;

/**
 * Pool de pg falso: cada connect() da un cliente que registra sus envíos. Un envío
 * "BEGIN; SET LOCAL …; consulta; COMMIT" devuelve un resultado por sentencia, como pg.
 */
function poolFalso(responder: (sql: string) => Promise<{ rows: unknown[] }>) {
  const envios: { text: string; query_timeout?: number }[] = [];
  const liberados: unknown[] = [];
  const pool = {
    connect: jest.fn(async () => ({
      query: jest.fn(async (q: string | { text: string; query_timeout?: number }) => {
        const envio = typeof q === 'string' ? { text: q } : q;
        envios.push(envio);
        if (PREFIJO.test(envio.text)) {
          const consulta = envio.text.replace(PREFIJO, '').replace(/\n;COMMIT$/, '');
          return [{ rows: [] }, { rows: [] }, await responder(consulta), { rows: [] }];
        }
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(envio.text)) return { rows: [] };
        return responder(envio.text);
      }),
      release: jest.fn((destruir?: unknown) => liberados.push(destruir)),
    })),
  };
  return { pool, envios, liberados };
}

function servicioCon(pool: unknown) {
  const servicio = new ExportDirectService();
  (servicio as any).pool = pool;
  return servicio;
}

describe('ExportDirectService: métricas del monitoreo', () => {
  it('cada consulta va en un solo envío con SET LOCAL statement_timeout y tiempo máximo del cliente', async () => {
    const { pool, envios } = poolFalso(async () => ({ rows: [{ pid: 1 }] }));

    const resultado = await servicioCon(pool).handleGet({ meta: 'locks' });

    expect(envios).toHaveLength(1);
    expect(envios[0].text).toMatch(/^BEGIN; SET LOCAL statement_timeout = 5000;\n[\s\S]+\n;COMMIT$/);
    expect(envios[0].query_timeout).toBe(10_000);
    expect(resultado).toMatchObject({ kind: 'json', status: 200 });
  });

  it('peticiones simultáneas de la misma métrica comparten una sola consulta, y luego sale de caché', async () => {
    let soltar!: () => void;
    const lenta = new Promise<void>((r) => (soltar = r));
    const { pool } = poolFalso(async () => {
      await lenta;
      return { rows: [{ pid: 1 }] };
    });
    const servicio = servicioCon(pool);

    const a = servicio.handleGet({ meta: 'activity' });
    const b = servicio.handleGet({ meta: 'activity' });
    soltar();
    const [ra, rb] = await Promise.all([a, b]);
    const rc = await servicio.handleGet({ meta: 'activity' });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(ra).toEqual(rb);
    expect(rc).toBe(ra);
  });

  it('un error de la base se relanza (lo responde el filtro global), sin devolver su texto ni quedar en caché', async () => {
    const errorPg = Object.assign(new Error('relation "public.usuarios" does not exist'), { code: '42P01', severity: 'ERROR' });
    const { pool, envios, liberados } = poolFalso(async () => {
      throw errorPg;
    });
    const servicio = servicioCon(pool);

    await expect(servicio.handleGet({ meta: 'table_stats' })).rejects.toBe(errorPg);
    await expect(servicio.handleGet({ meta: 'table_stats' })).rejects.toBe(errorPg);

    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(envios.filter((e) => e.text === 'ROLLBACK')).toHaveLength(2);
    expect(liberados).toEqual([undefined, undefined]);
  });

  it('sin DATABASE_URL lanza un 503 genérico (lo responde el filtro), sin nombrar la variable', async () => {
    const servicio = servicioCon(null);
    jest.spyOn((servicio as any).logger, 'error').mockImplementation(() => undefined);

    const error = await servicio.handleGet({ meta: 'locks' }).catch((e) => e);

    expect(error.getStatus()).toBe(503);
    expect(error.message).not.toContain('DATABASE_URL');
  });

  it('si Neon no responde (query_timeout de pg), la conexión se descarta sin esperar un ROLLBACK', async () => {
    const { pool, envios, liberados } = poolFalso(async () => {
      throw new Error('Query read timeout');
    });

    await expect(servicioCon(pool).handleGet({ meta: 'index_stats' })).rejects.toThrow('Query read timeout');

    expect(envios.some((e) => e.text === 'ROLLBACK')).toBe(false);
    expect(liberados).toEqual([true]);
  });
});
