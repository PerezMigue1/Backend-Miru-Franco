import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import express from 'express';
import { ipDelCliente } from './ip-cliente.util';

/**
 * En producción el backend está detrás de un solo proxy (el balanceador de Render). Con 'trust proxy' = 1,
 * req.ip es la dirección que agregó ese proxy, no el primer valor de x-forwarded-for, que lo escribe quien pide.
 */
async function ipVista(trustProxy: number | undefined, xff: string): Promise<string | null> {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => res.json({ ip: ipDelCliente(req as never) }));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  try {
    const { port } = servidor.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}/ip`, { headers: { 'x-forwarded-for': xff } });
    return ((await r.json()) as { ip: string | null }).ip;
  } finally {
    servidor.close();
  }
}

describe('IP de evidencia y del límite de peticiones detrás del proxy', () => {
  it('main.ts confía en un solo salto de proxy', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/\.set\('trust proxy', 1\)/);
  });

  it('con trust proxy = 1 se toma la IP que agregó el proxy, no la que escribió la clienta', async () => {
    expect(await ipVista(1, '6.6.6.6, 201.1.1.1')).toBe('201.1.1.1');
  });

  it('sin trust proxy todas las peticiones parecerían venir del proxy (la conexión directa)', async () => {
    expect(await ipVista(undefined, '6.6.6.6, 201.1.1.1')).toBe('127.0.0.1');
  });
});
