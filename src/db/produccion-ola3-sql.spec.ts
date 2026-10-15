import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * prisma/produccion_ola3.sql (entrega SIN APLICAR para el SQL Editor de Neon de producción): exactamente las
 * migraciones de esta ronda, cada bloque idéntico a su migration.sql, en una sola transacción, con la comprobación
 * de que la ola 2 ya está aplicada y su `migrate resolve --applied` en el encabezado.
 */
const PRISMA = join(__dirname, '..', '..', 'prisma');
const leer = (ruta: string) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
const SQL = leer(join(PRISMA, 'produccion_ola3.sql'));

const BLOQUES_ESPERADOS = [
  '20261016120000_reembolsos_pendientes',
  '20261016130000_configuracion_sitio',
  '20261016140000_contenido_publico',
  '20261016150000_politica_cookies_1_1',
  '20261016160000_firmas_subida',
];

function bloques(sql: string) {
  const encabezado = /^-- -{20,}\n-- (\d+)\. (\d{14}_[a-z0-9_]+)\n-- -{20,}\n/gm;
  const marcas = [...sql.matchAll(encabezado)];
  const finTransaccion = sql.search(/^COMMIT;$/m);
  return marcas.map((m, i) => {
    const desde = (m.index ?? 0) + m[0].length;
    const hasta = i + 1 < marcas.length ? (marcas[i + 1].index ?? 0) : finTransaccion;
    return { numero: Number(m[1]), migracion: m[2], contenido: sql.slice(desde, hasta) };
  });
}

describe('prisma/produccion_ola3.sql', () => {
  const lista = bloques(SQL);

  it('trae los bloques de esta ronda en orden (1 a 5)', () => {
    expect(lista.map((b) => [b.numero, b.migracion])).toEqual(BLOQUES_ESPERADOS.map((m, i) => [i + 1, m]));
  });

  it.each(BLOQUES_ESPERADOS)('el bloque %s es idéntico a su migration.sql', (migracion) => {
    const bloque = lista.find((b) => b.migracion === migracion);
    expect(bloque).toBeDefined();
    expect(bloque!.contenido.trim()).toBe(leer(join(PRISMA, 'migrations', migracion, 'migration.sql')).trim());
  });

  it('todo va en UNA transacción', () => {
    expect([...SQL.matchAll(/^BEGIN;$/gm)]).toHaveLength(1);
    expect([...SQL.matchAll(/^COMMIT;$/gm)]).toHaveLength(1);
    const [inicio, fin] = [SQL.search(/^BEGIN;$/m), SQL.search(/^COMMIT;$/m)];
    for (const m of SQL.matchAll(/^-- \d+\. \d{14}_/gm)) {
      expect(m.index).toBeGreaterThan(inicio);
      expect(m.index).toBeLessThan(fin);
    }
  });

  it('antes de todo comprueba que la ola 2 ya está aplicada (consentimientos.registrado_por_id y la función de solo inserción)', () => {
    const previa = SQL.slice(SQL.search(/^BEGIN;$/m), SQL.search(/^-- -{20,}\n-- 1\./m));
    expect(previa).toContain("column_name = 'registrado_por_id'");
    expect(previa).toContain("proname = 'rechazar_cambios_solo_insercion'");
    expect(previa).toContain('RAISE EXCEPTION');
  });

  it('la galería se siembra SIN public_id: borrar una foto sembrada nunca destruye en Cloudinary la imagen del servicio', () => {
    const bloque = lista.find((b) => b.migracion === '20261016140000_contenido_publico')!.contenido;
    const insercion = bloque.slice(bloque.indexOf('INSERT INTO "galeria_fotos"'), bloque.indexOf('FROM "servicios" s'));
    expect(insercion).toMatch(/"public_id"/);
    expect(insercion).toMatch(/^\s*NULL,/m);
    expect(insercion).not.toMatch(/substring\(/);
  });

  it('el encabezado marca cada bloque con migrate resolve --applied, en orden, y dice que va DESPUÉS de la ola 2', () => {
    const encabezado = SQL.slice(0, SQL.search(/^BEGIN;$/m));
    const marcadas = [...encabezado.matchAll(/npx prisma migrate resolve --applied (\d{14}_[a-z0-9_]+)/g)].map((m) => m[1]);
    expect(marcadas).toEqual(BLOQUES_ESPERADOS);
    expect(encabezado).toContain('produccion_ola2.sql');
  });
});
