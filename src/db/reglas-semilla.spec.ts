import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGLAS_POR_OMISION, validarReglas } from '../configuracion-sitio/reglas-negocio';

/**
 * La semilla de 20261017120000_reglas_negocio es exactamente REGLAS_POR_OMISION (los valores que estaban en el código):
 * desplegar no cambia ninguna regla. Lo ya guardado en la fila "reglas" gana sobre la semilla.
 */
const SQL = readFileSync(join(__dirname, '..', '..', 'prisma', 'migrations', '20261017120000_reglas_negocio', 'migration.sql'), 'utf8');

describe('Semilla de las reglas de negocio', () => {
  const json = SQL.match(/SET "valor" = '(\{.*\})'::jsonb \|\| "valor"/)?.[1];

  it('es el JSON de REGLAS_POR_OMISION y pasa la validación sin errores', () => {
    expect(json).toBeDefined();
    const semilla = JSON.parse(json!.replace(/''/g, "'"));
    expect(semilla).toEqual(REGLAS_POR_OMISION);
    expect(validarReglas(semilla, REGLAS_POR_OMISION).errores).toEqual([]);
  });

  it('lo guardado gana (semilla || valor) y las citas y pedidos existentes quedan con reglas en NULL', () => {
    expect(SQL).toContain(`'::jsonb || "valor"`);
    expect(SQL).toContain('ALTER TABLE "citas" ADD COLUMN "reglas" JSONB;');
    expect(SQL).toContain('ALTER TABLE "pedidos" ADD COLUMN "reglas" JSONB;');
    expect(SQL).not.toMatch(/UPDATE "(citas|pedidos)"/);
  });
});
