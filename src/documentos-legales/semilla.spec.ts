import { readFileSync } from 'fs';
import { join } from 'path';
import { VARIABLES_REGLAS } from '../configuracion-sitio/reglas-negocio';
import { documentoEditableDe } from './documentos-legales.constants';
import { armarDocumento } from './formato-documento';
import { hashTextoVisible, sanitizarHtml } from './html-seguro';
import { llenarVariables, variablesDesconocidas } from './variables-documento';

/**
 * La semilla de la migración 20261017130000_documentos_legales contra los hashes publicados: el texto visible de
 * cada html sembrado debe dar exactamente el hash_texto con que se sembró su versión (migraciones
 * 20261014130000_privacidad_y_consentimientos y 20261016150000_politica_cookies_1_1), y la plantilla sembrada,
 * llenada con sus variables congeladas y armada por el backend, debe dar ese mismo html.
 */
const MIGRACIONES = join(__dirname, '..', '..', 'prisma', 'migrations');
const leer = (nombre: string) => readFileSync(join(MIGRACIONES, nombre, 'migration.sql'), 'utf8');

/** Literales de texto ('...' con '' escapado) y booleanos de un fragmento de SQL, en orden. */
function valoresSql(sql: string): Array<string | boolean> {
  const valores: Array<string | boolean> = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      let texto = '';
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          texto += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else texto += sql[i++];
      }
      valores.push(texto);
      continue;
    }
    const resto = sql.slice(i);
    if (/^true\b/.test(resto)) {
      valores.push(true);
      i += 4;
      continue;
    }
    if (/^false\b/.test(resto)) {
      valores.push(false);
      i += 5;
      continue;
    }
    i++;
  }
  return valores;
}

/** (slug, versión) a hash de las versiones sembradas en las migraciones anteriores. */
function hashesPublicados(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const nombre of ['20261014130000_privacidad_y_consentimientos', '20261016150000_politica_cookies_1_1']) {
    for (const m of leer(nombre).matchAll(/\('([a-z-]+)', '(\d+\.\d+)', '([0-9a-f]{64})', DATE '(\d{4}-\d{2}-\d{2})'\)/g)) {
      mapa.set(`${m[1]} ${m[2]}`, m[3]);
    }
  }
  return mapa;
}

interface FilaSembrada {
  slug: string;
  version: string;
  html: string;
  plantilla: string;
  variables: Record<string, string>;
  requiereAceptacion: boolean;
  motivo: string;
}

function semilla(): FilaSembrada[] {
  const sql = leer('20261017130000_documentos_legales');
  const inicio = sql.indexOf('FROM (VALUES');
  const fin = sql.indexOf(') AS s("slug"');
  expect(inicio).toBeGreaterThan(0);
  const valores = valoresSql(sql.slice(inicio + 'FROM (VALUES'.length, fin));
  expect(valores.length % 7).toBe(0);
  const filas: FilaSembrada[] = [];
  for (let i = 0; i < valores.length; i += 7) {
    const [slug, version, html, plantilla, variables, requiere, motivo] = valores.slice(i, i + 7);
    filas.push({
      slug: slug as string,
      version: version as string,
      html: html as string,
      plantilla: plantilla as string,
      variables: JSON.parse(variables as string),
      requiereAceptacion: requiere as boolean,
      motivo: motivo as string,
    });
  }
  return filas;
}

const VIGENTES = ['terminos 2.0', 'aviso-privacidad 2.0', 'cookies 1.1', 'reembolsos 1.0', 'anticipos 1.0'];

describe('Semilla de los documentos legales (migración 20261017130000_documentos_legales)', () => {
  const filas = semilla();
  const publicados = hashesPublicados();

  it('siembra exactamente las 5 versiones vigentes', () => {
    expect(filas.map((f) => `${f.slug} ${f.version}`)).toEqual(VIGENTES);
  });

  it.each(VIGENTES)('%s: el hash del texto visible del html sembrado es el publicado en versiones_documentos_legales', (clave) => {
    const fila = filas.find((f) => `${f.slug} ${f.version}` === clave)!;
    expect(publicados.get(clave)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTextoVisible(fila.html)).toBe(publicados.get(clave));
  });

  it.each(VIGENTES)('%s: la lista blanca deja el html sembrado igual', (clave) => {
    const fila = filas.find((f) => `${f.slug} ${f.version}` === clave)!;
    expect(sanitizarHtml(fila.html)).toBe(fila.html);
  });

  it.each(VIGENTES)('%s: la plantilla con sus variables congeladas, armada por el backend, da el mismo html', (clave) => {
    const fila = filas.find((f) => `${f.slug} ${f.version}` === clave)!;
    const doc = documentoEditableDe(fila.slug)!;
    expect(variablesDesconocidas(fila.plantilla, VARIABLES_REGLAS)).toEqual([]);
    const fechas: Record<string, string> = { 'cookies 1.1': '2026-10-16' };
    const { html, errores } = armarDocumento(
      { tituloPagina: doc.tituloPagina, etiquetaIndice: doc.etiquetaIndice, version: fila.version, vigenteDesde: fechas[clave] ?? '2026-10-14' },
      llenarVariables(fila.plantilla, fila.variables),
    );
    expect(errores).toEqual([]);
    expect(html).toBe(fila.html);
  });

  it('reembolsos y anticipos comparten página, texto y hash', () => {
    const r = filas.find((f) => f.slug === 'reembolsos')!;
    const a = filas.find((f) => f.slug === 'anticipos')!;
    expect(a.html).toBe(r.html);
    expect(a.plantilla).toBe(r.plantilla);
    expect(r.html).toContain('id="anticipos"');
  });

  it('las variables sembradas guardan el valor que la página muestra hoy (los plazos de los Términos)', () => {
    const t = filas.find((f) => f.slug === 'terminos')!;
    expect(t.variables).toMatchObject({ plazoPagoLineaHoras: '24', diasGarantia: '7', toleranciaLlegadaMinutos: '15', minutosAntesPagoSalon: '15' });
    expect(t.plantilla).toContain('{plazoPagoLineaHoras} horas');
    expect(filas.find((f) => f.slug === 'aviso-privacidad')!.variables).toEqual({});
  });

  it('solo cookies 1.1 se sembró sin pedir volver a aceptar; todas llevan motivo', () => {
    expect(filas.filter((f) => !f.requiereAceptacion).map((f) => f.slug)).toEqual(['cookies']);
    for (const f of filas) expect(f.motivo.length).toBeGreaterThan(20);
  });

  it('la migración no tiene guiones largos ni conexión a producción', () => {
    const sql = leer('20261017130000_documentos_legales');
    expect(sql).not.toContain(String.fromCharCode(0x2014));
    // Ningún host de la base de datos ni cadena de conexión.
    expect(sql).not.toMatch(/\bep-[a-z]+-[a-z]+-[a-z0-9]+|postgres(ql)?:\/\//);
  });
});
