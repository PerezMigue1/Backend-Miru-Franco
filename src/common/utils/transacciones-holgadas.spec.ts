import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Las transacciones interactivas de privacidad (consentimientos, ARCO, cambio de correo, alta con Google y edición
 * de usuarias) hacen varias escrituras seguidas. Con el tiempo límite por defecto de Prisma (5 s) y la latencia de la
 * base, la anonimización de una cuenta respondía 500 (P2028: "Transaction already closed"). Deben pasar el tiempo
 * holgado compartido (TX_HOLGADA, 15 s), como las de caja y pedidos.
 */
const ARCHIVOS = [
  'arco/arco.service.ts',
  'consentimientos/consentimientos.service.ts',
  'auth/cambio-correo.service.ts',
  'auth/auth.service.ts',
  'usuarios/usuarios.service.ts',
];

/** Segundo argumento de cada `$transaction(async ...)` del archivo (o null si no lo hay). */
function opcionesDeTransacciones(fuente: string): { linea: number; opciones: string | null }[] {
  const salida: { linea: number; opciones: string | null }[] = [];
  let i = 0;
  while ((i = fuente.indexOf('$transaction(async', i)) >= 0) {
    let j = i + '$transaction('.length;
    let nivel = 1;
    let coma = -1;
    let cadena: string | null = null;
    for (; j < fuente.length && nivel > 0; j++) {
      const c = fuente[j];
      if (cadena) {
        if (c === cadena && fuente[j - 1] !== '\\') cadena = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') cadena = c;
      else if ('([{'.includes(c)) nivel++;
      else if (')]}'.includes(c)) nivel--;
      else if (c === ',' && nivel === 1) coma = j;
    }
    salida.push({ linea: fuente.slice(0, i).split('\n').length, opciones: coma > 0 ? fuente.slice(coma + 1, j - 1).trim() : null });
    i = j;
  }
  return salida;
}

describe('Transacciones de privacidad con tiempo límite holgado', () => {
  it.each(ARCHIVOS)('%s pasa TX_HOLGADA a cada transacción interactiva', (archivo) => {
    const fuente = readFileSync(join(__dirname, '..', '..', archivo), 'utf8');
    const transacciones = opcionesDeTransacciones(fuente);
    expect(transacciones.length).toBeGreaterThan(0);
    const sinTiempo = transacciones.filter((t) => t.opciones !== 'TX_HOLGADA').map((t) => `línea ${t.linea}`);
    expect(sinTiempo).toEqual([]);
  });
});
