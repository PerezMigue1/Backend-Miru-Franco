import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * prisma/produccion_ola4.sql (entrega SIN APLICAR para el SQL Editor de Neon de producción): exactamente las
 * migraciones de esta ronda, cada bloque idéntico a su migration.sql, en una sola transacción, con la comprobación
 * de que la ola 3 ya está aplicada y su `migrate resolve --applied` en el encabezado.
 */
const PRISMA = join(__dirname, '..', '..', 'prisma');
const leer = (ruta: string) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
const SQL = leer(join(PRISMA, 'produccion_ola4.sql'));

const BLOQUES_ESPERADOS = [
  '20261017120000_reglas_negocio',
  '20261017130000_documentos_legales',
  '20261017140000_textos_sitio',
  '20261017150000_permisos_operacion_sitio',
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

describe('prisma/produccion_ola4.sql', () => {
  const lista = bloques(SQL);

  it('trae los bloques de esta ronda en orden (1 a 4)', () => {
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

  it('antes de todo comprueba que la ola 3 está aplicada y que la 4 no se corrió ya', () => {
    const previa = SQL.slice(SQL.search(/^BEGIN;$/m), SQL.search(/^-- -{20,}\n-- 1\./m));
    expect(previa).toContain("table_name = 'firmas_subida'");
    expect(previa).toContain("indexname = 'galeria_fotos_public_id_key'");
    expect(previa).toContain("column_name = 'reglas'");
    expect([...previa.matchAll(/RAISE EXCEPTION/g)]).toHaveLength(2);
  });

  it('el encabezado marca cada bloque con migrate resolve --applied, en orden, y dice que va DESPUÉS de la ola 3', () => {
    const encabezado = SQL.slice(0, SQL.search(/^BEGIN;$/m));
    const marcadas = [...encabezado.matchAll(/npx prisma migrate resolve --applied (\d{14}_[a-z0-9_]+)/g)].map((m) => m[1]);
    expect(marcadas).toEqual(BLOQUES_ESPERADOS);
    expect(encabezado).toContain('produccion_ola3.sql');
  });

  it('solo aditivo: sin DROP, sin DELETE y sin UPDATE de citas o pedidos', () => {
    expect(SQL).not.toMatch(/^\s*(DROP|TRUNCATE)\b/im);
    expect(SQL).not.toMatch(/^\s*DELETE FROM/im);
    expect(SQL).not.toMatch(/UPDATE "(citas|pedidos)"/);
  });
});
