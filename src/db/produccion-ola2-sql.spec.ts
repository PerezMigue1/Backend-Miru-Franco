import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * prisma/produccion_ola2.sql (archivo de entrega para el SQL Editor de Neon de producción) debe ser exactamente
 * las migraciones que dice representar: cada bloque "-- N. <migración>" idéntico a su migration.sql (sin contar
 * CRLF), todo en una sola transacción y con su `migrate resolve --applied` en el encabezado.
 */
const PRISMA = join(__dirname, '..', '..', 'prisma');
const leer = (ruta: string) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');
const SQL = leer(join(PRISMA, 'produccion_ola2.sql'));

const BLOQUES_ESPERADOS = [
  '20261014130000_privacidad_y_consentimientos',
  '20261014140000_observaciones_y_cambio_correo',
  '20261014150000_revocacion_compra',
  '20261014160000_consentimiento_registrado_por',
];
const PREVIA = '20261014120000_producto_activo';

/** Bloques del archivo: { numero, migracion, contenido } entre cada encabezado y el siguiente (o el COMMIT). */
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

describe('prisma/produccion_ola2.sql', () => {
  const lista = bloques(SQL);

  it('trae los bloques de esta ola en orden (1 a 4), el último el de consentimientos.registrado_por_id', () => {
    expect(lista.map((b) => [b.numero, b.migracion])).toEqual(BLOQUES_ESPERADOS.map((m, i) => [i + 1, m]));
  });

  it.each(BLOQUES_ESPERADOS)('el bloque %s es idéntico a su migration.sql', (migracion) => {
    const bloque = lista.find((b) => b.migracion === migracion);
    expect(bloque).toBeDefined();
    const archivo = join(PRISMA, 'migrations', migracion, 'migration.sql');
    expect(bloque!.contenido.trim()).toBe(leer(archivo).trim());
  });

  it('todo va en UNA transacción: un BEGIN; al inicio, un COMMIT; al final y los bloques entre los dos', () => {
    const inicios = [...SQL.matchAll(/^BEGIN;$/gm)];
    const fines = [...SQL.matchAll(/^COMMIT;$/gm)];
    expect(inicios).toHaveLength(1);
    expect(fines).toHaveLength(1);
    const [inicio, fin] = [inicios[0].index ?? 0, fines[0].index ?? 0];
    expect(inicio).toBeLessThan(fin);
    for (const m of SQL.matchAll(/^-- \d+\. \d{14}_/gm)) {
      expect(m.index).toBeGreaterThan(inicio);
      expect(m.index).toBeLessThan(fin);
    }
  });

  it('el encabezado marca cada bloque con migrate resolve --applied, en orden', () => {
    const encabezado = SQL.slice(0, SQL.search(/^BEGIN;$/m));
    const marcadas = [...encabezado.matchAll(/npx prisma migrate resolve --applied (\d{14}_[a-z0-9_]+)/g)].map((m) => m[1]);
    expect(marcadas.filter((m) => m !== PREVIA)).toEqual(BLOQUES_ESPERADOS);
  });

  it('paso 0: la migración de producto activo es de este mismo paquete y se aplica antes, desde su migration.sql', () => {
    const encabezado = SQL.slice(0, SQL.search(/^BEGIN;$/m));
    expect(existsSync(join(PRISMA, 'migrations', PREVIA, 'migration.sql'))).toBe(true);
    expect(encabezado).toContain(`prisma/migrations/${PREVIA}/migration.sql`);
    expect(encabezado).toContain(`npx prisma migrate resolve --applied ${PREVIA}`);
    expect(encabezado).not.toMatch(/ola anterior/);
  });

  it('el bloque 4 no lleva ninguna acción que modifique filas de consentimientos (solo inserción)', () => {
    const bloque = lista.find((b) => b.migracion === '20261014160000_consentimiento_registrado_por');
    expect(bloque?.contenido).toContain('ADD COLUMN "registrado_por_id" TEXT;');
    expect(bloque?.contenido).toContain('CREATE INDEX "consentimientos_registrado_por_id_idx"');
    expect(bloque?.contenido).toContain('REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;');
    expect(bloque?.contenido).not.toMatch(/CASCADE|SET NULL|SET DEFAULT|^\s*UPDATE /m);
  });
});
