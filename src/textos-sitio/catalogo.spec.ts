import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VARIABLES_REGLAS } from '../configuracion-sitio/reglas-negocio';
import { CATALOGO_TEXTOS, PAGINAS_TEXTOS, VARIABLES_CONTEXTO } from './catalogo';
import { erroresTexto, variablesDeTexto } from './textos-sitio.util';

/**
 * Catálogo de Textos del sitio: claves únicas y estables, valores por defecto válidos (largo, variables, sin HTML) y
 * la copia de la web (miru-franco-web/src/app/utils/textosSitio.ts) igual a los textos públicos de aquí.
 */
describe('Catálogo de textos del sitio', () => {
  it('cada clave es única y tiene página, descripción y tipo', () => {
    const claves = CATALOGO_TEXTOS.map((t) => t.clave);
    expect(new Set(claves).size).toBe(claves.length);
    for (const t of CATALOGO_TEXTOS) {
      expect(t.clave).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/);
      expect(PAGINAS_TEXTOS).toContain(t.pagina);
      expect(t.descripcion.length).toBeGreaterThan(5);
      expect(['texto', 'correo-asunto', 'correo-cuerpo', 'aviso-titulo', 'aviso-mensaje']).toContain(t.tipo);
    }
  });

  it('el valor por defecto pasa su propia validación (largo, variables existentes, llaves y sin HTML)', () => {
    for (const t of CATALOGO_TEXTOS) {
      expect({ clave: t.clave, errores: erroresTexto(t, t.porDefecto) }).toEqual({ clave: t.clave, errores: [] });
      expect(t.porDefecto.length).toBeLessThanOrEqual(t.max);
    }
  });

  it('las variables de contexto están descritas y no chocan con las de reglas', () => {
    for (const t of CATALOGO_TEXTOS) {
      for (const v of t.contexto) {
        expect(VARIABLES_CONTEXTO[v]).toBeDefined();
        expect(VARIABLES_REGLAS).not.toContain(v);
      }
    }
  });

  it('ningún texto usa el guion largo', () => {
    expect(CATALOGO_TEXTOS.filter((t) => t.porDefecto.concat(t.descripcion).includes(String.fromCharCode(0x2014))).map((t) => t.clave)).toEqual([]);
  });

  it('siembra los valores de hoy: textos de procesos, avisos, botones importantes, listas vacías y correos', () => {
    const porDefecto = Object.fromEntries(CATALOGO_TEXTOS.map((t) => [t.clave, t.porDefecto]));
    expect(porDefecto['citas.crear.botonConfirmar']).toBe('Confirmar cita');
    expect(porDefecto['anticipos.botonPagar']).toBe('Pagar anticipo');
    expect(porDefecto['checkout.recogerAviso']).toContain('Te avisamos en la app y por correo');
    expect(porDefecto['pedidos.lista.vacia']).toBe('No tienes pedidos realizados');
    expect(porDefecto['avisos.recordatorioRecoger.mensaje']).toContain('{diasRestantesRecoger}');
    expect(variablesDeTexto(porDefecto['avisos.pedidoVencido.sinPreparar'])).toEqual(['pedido', 'diasPrepararApartado']);
  });

  it('la copia de la web tiene exactamente los textos públicos con los mismos valores por defecto', () => {
    const archivo = join(__dirname, '..', '..', '..', 'miru-franco-web', 'src', 'app', 'utils', 'textosSitio.ts');
    if (!existsSync(archivo)) {
      console.warn(`No se encontró ${archivo}: se salta la comparación con la web.`);
      return;
    }
    const fuente = readFileSync(archivo, 'utf8');
    const inicio = fuente.indexOf('{', fuente.indexOf('TEXTOS_POR_OMISION'));
    const fin = fuente.indexOf('\n};', inicio);
    const web = JSON.parse(fuente.slice(inicio, fin + 2).replace(/,\s*}$/, '}')) as Record<string, string>;
    const publicos = Object.fromEntries(CATALOGO_TEXTOS.filter((t) => t.tipo === 'texto').map((t) => [t.clave, t.porDefecto]));
    expect(web).toEqual(publicos);
  });

  it('la migración siembra una fila por clave con el valor de hoy', () => {
    const archivo = join(__dirname, '..', '..', 'prisma', 'migrations', '20261017140000_textos_sitio', 'migration.sql');
    if (!existsSync(archivo)) {
      console.warn('No está la migración 20261017140000_textos_sitio (la carpeta está en .gitignore): se salta.');
      return;
    }
    const sql = readFileSync(archivo, 'utf8');
    for (const t of CATALOGO_TEXTOS) expect(sql).toContain(`('${t.clave}', '${t.porDefecto.replace(/'/g, "''")}')`);
  });
});
