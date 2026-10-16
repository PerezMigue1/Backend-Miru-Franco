import { createHash } from 'crypto';

/**
 * HTML de los documentos legales: lectura, limpieza con lista blanca y la regla del hash.
 *
 * La regla del hash es la misma de la web (components/legal/paginasLegales.test.ts y
 * scripts/hash-documentos-legales.mjs): SHA-256 hexadecimal (UTF-8) del texto visible, que es el html sin
 * etiquetas, con &quot; &#x27; &lt; &gt; y &amp; decodificados y con los espacios y saltos colapsados en uno.
 * Sin dependencias: un lector pequeño de etiquetas basta porque el html que se publica lo arma el propio backend
 * (formato-documento.ts) y siempre pasa por sanitizarHtml antes de guardarse.
 */

/** Texto visible del html: la base del hash de cada documento legal. */
export function textoVisible(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SHA-256 en hexadecimal del texto (UTF-8). */
export function hashTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function hashTextoVisible(html: string): string {
  return hashTexto(textoVisible(html));
}

// ---------------------------------------------------------------- Árbol

export interface NodoTexto {
  tipo: 'texto';
  /** Texto ya decodificado (sin entidades). */
  valor: string;
}

export interface NodoElemento {
  tipo: 'elemento';
  /** En minúsculas. */
  nombre: string;
  /** Nombre tal como venía (para conservar dateTime o viewBox) y valor decodificado. */
  atributos: Array<[string, string]>;
  hijos: Nodo[];
}

export type Nodo = NodoTexto | NodoElemento;

const VACIOS = new Set(['br', 'hr', 'img', 'wbr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track']);
/** Su contenido es texto crudo hasta la etiqueta de cierre: se descarta completo. */
const TEXTO_CRUDO = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decodifica las entidades con nombre conocidas y las numéricas. Las desconocidas quedan como texto. */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (m, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? Number.parseInt(cuerpo.slice(2), 16) : Number.parseInt(cuerpo.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return m;
      return String.fromCodePoint(n);
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? m;
  });
}

/** Escapa como React (escapeTextForBrowser): & < > " y '. */
export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] as string);
}

const ETIQUETA = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const ATRIBUTO = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function leerAtributos(crudo: string): Array<[string, string]> {
  const lista: Array<[string, string]> = [];
  for (const m of crudo.matchAll(ATRIBUTO)) {
    const valor = m[2] ?? m[3] ?? m[4] ?? '';
    lista.push([m[1], decodificarEntidades(valor)]);
  }
  return lista;
}

/** Lee el html como árbol. Cierra lo que quede abierto e ignora los cierres que no corresponden. */
export function leerHtml(html: string): Nodo[] {
  const raiz: NodoElemento = { tipo: 'elemento', nombre: '#raiz', atributos: [], hijos: [] };
  const pila: NodoElemento[] = [raiz];
  const actual = () => pila[pila.length - 1];
  let texto = '';
  const soltarTexto = () => {
    if (texto) actual().hijos.push({ tipo: 'texto', valor: decodificarEntidades(texto) });
    texto = '';
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      texto += html.slice(i);
      break;
    }
    texto += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const fin = html.indexOf('-->', lt + 4);
      i = fin < 0 ? html.length : fin + 3;
      continue;
    }
    const m = ETIQUETA.exec(html.slice(lt));
    if (!m) {
      // "<" suelto (o "<!doctype", "<?"): se queda como texto y luego se escapa.
      if (/^<[!?]/.test(html.slice(lt, lt + 2))) {
        const fin = html.indexOf('>', lt);
        i = fin < 0 ? html.length : fin + 1;
        continue;
      }
      texto += '<';
      i = lt + 1;
      continue;
    }
    soltarTexto();
    const [completo, cierre, nombreCrudo, atributosCrudos, autocierre] = m;
    const nombre = nombreCrudo.toLowerCase();
    i = lt + completo.length;
    if (cierre) {
      const pos = pila.map((n) => n.nombre).lastIndexOf(nombre);
      if (pos > 0) pila.length = pos;
      continue;
    }
    const nodo: NodoElemento = { tipo: 'elemento', nombre, atributos: leerAtributos(atributosCrudos), hijos: [] };
    actual().hijos.push(nodo);
    if (TEXTO_CRUDO.has(nombre)) {
      const fin = html.toLowerCase().indexOf(`</${nombre}`, i);
      i = fin < 0 ? html.length : html.indexOf('>', fin) + 1 || html.length;
      continue;
    }
    if (!autocierre && !VACIOS.has(nombre)) pila.push(nodo);
  }
  soltarTexto();
  return raiz.hijos;
}

/** Escribe el árbol como lo escribe React (renderToStaticMarkup): atributos con comillas dobles y vacíos con "/>". */
export function escribirHtml(nodos: Nodo[]): string {
  let salida = '';
  for (const n of nodos) {
    if (n.tipo === 'texto') {
      salida += escaparHtml(n.valor);
      continue;
    }
    const atributos = n.atributos.map(([k, v]) => ` ${k}="${escaparHtml(v)}"`).join('');
    if (VACIOS.has(n.nombre)) salida += `<${n.nombre}${atributos}/>`;
    else salida += `<${n.nombre}${atributos}>${escribirHtml(n.hijos)}</${n.nombre}>`;
  }
  return salida;
}

// ---------------------------------------------------------------- Lista blanca

/** Etiquetas que usan hoy las páginas legales (y unas pocas de formato). Las demás se quitan y su texto se queda. */
const ETIQUETAS_PERMITIDAS = new Set([
  'main', 'div', 'header', 'nav', 'details', 'summary', 'article', 'section',
  'h1', 'h2', 'h3', 'h4', 'p', 'span', 'strong', 'em', 'b', 'i', 'u', 'small', 'code', 'a', 'br', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'time', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g',
]);
/** Se quitan con todo su contenido. */
const ETIQUETAS_PELIGROSAS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'foreignobject', 'use', 'image', 'animate', 'set', 'math', 'form', 'input', 'button', 'textarea', 'select', 'noscript', 'link', 'meta', 'base', 'frame', 'frameset', 'img', 'video', 'audio', 'source', 'canvas']);
const SVG = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g']);

/** true si la etiqueta está en la lista blanca (el formato sencillo solo lee como html las permitidas). */
export function etiquetaPermitida(nombre: string): boolean {
  return ETIQUETAS_PERMITIDAS.has(nombre.toLowerCase());
}

const CLASE = /^[A-Za-z0-9_\-:/.[\]%! ]{0,400}$/;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,80}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const VALOR_SVG = /^[A-Za-z0-9 .,#%-]{0,4000}$/;
const DECLARACION_ESTILO = /^(color|background-color|border|border-color|box-shadow):\s*(var\(--[a-z0-9-]+\)|none|transparent|currentColor)$/i;
const ATRIBUTOS_SVG = new Set(['width', 'height', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'points']);

/** Enlace permitido: ruta interna ("/..." sin "//"), ancla, https, mailto o tel. */
export function enlacePermitido(href: string): boolean {
  // Quita espacios y controles que el navegador ignora (por ejemplo "java\tscript:").
  // eslint-disable-next-line no-control-regex
  const limpio = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (!limpio) return false;
  if (limpio.startsWith('#')) return /^#[A-Za-z0-9_-]*$/.test(limpio);
  if (limpio.startsWith('/')) return !limpio.startsWith('//') && !limpio.startsWith('/\\');
  return /^(https:\/\/[^\s/?#]+|mailto:[^\s]+|tel:\+?[0-9-]+$)/i.test(limpio);
}

function estiloPermitido(estilo: string): boolean {
  const partes = estilo.split(';').map((p) => p.trim()).filter(Boolean);
  return partes.length > 0 && partes.length <= 6 && partes.every((p) => DECLARACION_ESTILO.test(p));
}

function atributoPermitido(etiqueta: string, nombre: string, valor: string): boolean {
  const n = nombre.toLowerCase();
  if (n.startsWith('on')) return false;
  if (n === 'class') return CLASE.test(valor);
  if (n === 'id') return ID.test(valor);
  if (n === 'aria-hidden') return valor === 'true' || valor === 'false';
  if (n === 'aria-label') return valor.length <= 200;
  if (n === 'aria-labelledby' || n === 'aria-describedby') return valor.split(' ').every((v) => ID.test(v));
  if (n === 'style') return estiloPermitido(valor);
  if (etiqueta === 'a') {
    if (n === 'href') return enlacePermitido(valor);
    if (n === 'target') return valor === '_blank';
    if (n === 'rel') return /^[a-z ]{0,40}$/.test(valor);
  }
  if (etiqueta === 'time' && n === 'datetime') return FECHA.test(valor);
  if ((etiqueta === 'td' || etiqueta === 'th') && (n === 'colspan' || n === 'rowspan')) return /^[1-9]$/.test(valor);
  if (etiqueta === 'th' && n === 'scope') return ['col', 'row'].includes(valor);
  if (etiqueta === 'details' && n === 'open') return valor === '' || valor === 'open';
  if (SVG.has(etiqueta)) {
    if (n === 'xmlns') return etiqueta === 'svg' && valor === 'http://www.w3.org/2000/svg';
    return ATRIBUTOS_SVG.has(n) && VALOR_SVG.test(valor);
  }
  return false;
}

function limpiar(nodos: Nodo[], dentroDeSvg: boolean): Nodo[] {
  const salida: Nodo[] = [];
  for (const n of nodos) {
    if (n.tipo === 'texto') {
      // Dentro de un svg no hay texto visible permitido.
      if (!dentroDeSvg) salida.push(n);
      continue;
    }
    if (ETIQUETAS_PELIGROSAS.has(n.nombre)) continue;
    const esSvg = SVG.has(n.nombre);
    const permitida = ETIQUETAS_PERMITIDAS.has(n.nombre) && (dentroDeSvg ? esSvg && n.nombre !== 'svg' : n.nombre === 'svg' || !esSvg);
    if (!permitida) {
      if (!dentroDeSvg) salida.push(...limpiar(n.hijos, false));
      continue;
    }
    const atributos = n.atributos.filter(([k, v]) => atributoPermitido(n.nombre, k, v));
    if (n.nombre === 'a' && atributos.some(([k, v]) => k.toLowerCase() === 'target' && v === '_blank')) {
      const sinRel = atributos.filter(([k]) => k.toLowerCase() !== 'rel');
      sinRel.push(['rel', 'noopener noreferrer']);
      atributos.splice(0, atributos.length, ...sinRel);
    }
    salida.push({ tipo: 'elemento', nombre: n.nombre, atributos, hijos: limpiar(n.hijos, dentroDeSvg || n.nombre === 'svg') });
  }
  return salida;
}

/**
 * Html seguro para publicar: solo las etiquetas y atributos de la lista blanca, sin script, style, iframe ni
 * atributos on*, con enlaces internos, https, mailto o tel, y el texto escapado como lo escribe React (así el
 * html que ya es seguro, como el que pinta la web, sale igual).
 */
export function sanitizarHtml(html: string): string {
  return escribirHtml(limpiar(leerHtml(html), false));
}
