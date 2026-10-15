import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLAS_BLOQUEADAS_OPERACIONES, esColumnaSecreta, neutralizarFormulaCsv } from './db.constants';

describe('neutralizarFormulaCsv (OWASP CSV injection)', () => {
  it.each([
    ['=HYPERLINK("http://x")'],
    ['+cmd'],
    ['-2+3'],
    ['@SUM(A1)'],
    ['\t=1+1'],
    ['\tcualquier cosa'],
    ['\r=1+1'],
    ['\rcualquier cosa'],
  ])('%j empieza con un carácter que Excel o Sheets interpretan: lleva comilla simple delante', (valor) => {
    expect(neutralizarFormulaCsv(valor)).toBe(`'${valor}`);
  });

  it.each([['-150.00'], ['+5'], ['texto normal'], [''], ['a\tb'], ['a\rb']])('%j no cambia', (valor) => {
    expect(neutralizarFormulaCsv(valor)).toBe(valor);
  });
});

describe('esColumnaSecreta: códigos y tokens de un solo uso', () => {
  it.each(['codigo_hash', 'codigoHash', 'codigo', 'codigoOTP', 'token', 'token_hash', 'resetPasswordToken', 'password', 'respuesta_seguridad'])(
    '%s es secreta',
    (columna) => expect(esColumnaSecreta(columna)).toBe(true),
  );

  it.each(['codigo_postal', 'error_codigo', 'documento_hash', 'hash_texto', 'email', 'expira_en'])('%s no es secreta', (columna) =>
    expect(esColumnaSecreta(columna)).toBe(false),
  );
});

describe('TABLAS_BLOQUEADAS_OPERACIONES', () => {
  it('cada tabla bloqueada (menos _prisma_migrations) existe en schema.prisma: un nombre mal escrito dejaría la tabla sin bloquear', () => {
    const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
    const mapeadas = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]));
    const faltan = TABLAS_BLOQUEADAS_OPERACIONES.filter((t) => t !== '_prisma_migrations' && !mapeadas.has(t));
    expect(faltan).toEqual([]);
  });

  it('el comentario ya no dice que las tablas de privacidad "aún no existen"', () => {
    const fuente = readFileSync(join(__dirname, 'db.constants.ts'), 'utf8');
    expect(fuente).not.toMatch(/aún no existen/);
  });
});
