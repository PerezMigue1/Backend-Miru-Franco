import { enlacePermitido, escaparHtml, escribirHtml, etiquetaPermitida, leerHtml, Nodo, NodoElemento, sanitizarHtml } from './html-seguro';

/**
 * Formato sencillo de los documentos legales (lo que edita la dueña en Admin > Documentos legales) y su paso a html
 * con las mismas clases y la misma estructura que pinta la web (components/legal/DocumentoLegal.tsx y
 * EncabezadoVersion.tsx). Así el texto visible, y con él el hash, sale igual que el de la página de React.
 *
 * Formato (bloques separados por una línea en blanco):
 * - "## Título {#ancla}": sección numerada (el ancla es opcional; sin ella se genera del título).
 * - "### Subtítulo".
 * - "- elemento": lista con viñetas; "1. elemento": lista numerada. Una línea con sangría sigue al elemento anterior.
 * - Texto normal: párrafo (las líneas seguidas se unen con un espacio). Los párrafos antes de la primera sección
 *   son la introducción.
 * - En el texto: **negritas**, [texto](enlace), `código` y {variable}.
 * - Una línea que empieza con una etiqueta de bloque (<div ...>, <p ...>, <ul ...>) es un bloque con formato
 *   especial: se publica tal cual, después de limpiarlo con la lista blanca.
 */

export interface SeccionDocumento {
  id: string;
  titulo: string;
}

export interface DatosArmazon {
  /** Título grande de la página (h1). */
  tituloPagina: string;
  /** aria-label del índice. */
  etiquetaIndice: string;
  version: string;
  /** YYYY-MM-DD. */
  vigenteDesde: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "14 de octubre de 2026" (como fechaVigenciaTexto de la web, es-MX, sin desfase de zona). */
export function fechaVigenciaTexto(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

// Íconos de lucide-react tal como los pinta la web (ChevronDown y FileCheck2).
const ICONO_CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down mf-terminos__chevron" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
const ICONO_VERSION =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-check-corner mt-1 shrink-0" aria-hidden="true" style="color:var(--logo-branding)"><path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v6"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="m14 20 2 2 4-4"></path></svg>';
const CLASE_ENCABEZADO = 'mb-8 flex items-start gap-2 text-sm font-medium';
const INICIO_ARTICULO = '<article class="mf-legal mf-terminos__texto">';
const FIN_DOCUMENTO = '</article></div></div></main>';

/** Etiquetas que, al inicio de una línea, abren un bloque con formato especial. */
const BLOQUES_HTML = new Set(['div', 'p', 'ul', 'ol', 'dl', 'table', 'h3', 'h4', 'blockquote', 'details', 'hr', 'section', 'nav', 'header', 'article', 'figure']);
const INICIO_BLOQUE_HTML = /^<([a-zA-Z][a-zA-Z0-9]*)[\s>/]/;
const TITULO_SECCION = /^## (.*?)(?:\s*\{#([^}]*)\})?\s*$/;
const ANCLA = /^[A-Za-z][A-Za-z0-9_-]{0,80}$/;
const ELEMENTO_LISTA = /^(-|\d+\.) (.*)$/;

type Bloque =
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'subtitulo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; elementos: string[] }
  | { tipo: 'html'; html: string }
  | { tipo: 'seccion'; titulo: string; ancla: string | null };

function esBloqueHtml(linea: string): boolean {
  const m = INICIO_BLOQUE_HTML.exec(linea);
  return !!m && BLOQUES_HTML.has(m[1].toLowerCase());
}

function leerBloques(marcado: string): Bloque[] {
  const lineas = marcado.replace(/\r\n?/g, '\n').split('\n');
  const bloques: Bloque[] = [];
  let actual: Bloque | null = null;
  const cerrar = () => {
    if (actual) bloques.push(actual);
    actual = null;
  };
  const unir = (a: string, b: string) => `${a.replace(/\s+$/, '')} ${b.replace(/^\s+/, '')}`;
  for (const linea of lineas) {
    if (linea.trim() === '') {
      cerrar();
      continue;
    }
    const abierto = actual as Bloque | null;
    if (abierto?.tipo === 'html') {
      abierto.html += `\n${linea}`;
      continue;
    }
    const seccion = TITULO_SECCION.exec(linea);
    if (seccion) {
      cerrar();
      bloques.push({ tipo: 'seccion', titulo: seccion[1], ancla: seccion[2] ?? null });
      continue;
    }
    if (linea.startsWith('### ')) {
      cerrar();
      bloques.push({ tipo: 'subtitulo', texto: linea.slice(4) });
      continue;
    }
    if (esBloqueHtml(linea)) {
      cerrar();
      actual = { tipo: 'html', html: linea };
      continue;
    }
    const elemento = ELEMENTO_LISTA.exec(linea);
    if (elemento) {
      const ordenada = elemento[1] !== '-';
      if (abierto?.tipo !== 'lista' || abierto.ordenada !== ordenada) {
        cerrar();
        actual = { tipo: 'lista', ordenada, elementos: [] };
      }
      (actual as unknown as { elementos: string[] }).elementos.push(elemento[2]);
      continue;
    }
    if (abierto?.tipo === 'lista') {
      const ultimo = abierto.elementos.length - 1;
      abierto.elementos[ultimo] = unir(abierto.elementos[ultimo], linea);
      continue;
    }
    if (abierto?.tipo === 'parrafo') {
      abierto.texto = unir(abierto.texto, linea);
      continue;
    }
    cerrar();
    actual = { tipo: 'parrafo', texto: linea };
  }
  cerrar();
  return bloques;
}

const ETIQUETA_EN_LINEA = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/;
const ENTIDAD = /^&(?:#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/i;

/** "[texto](enlace)" al inicio del texto, con paréntesis balanceados dentro del enlace. null si no lo es. */
function enlaceEn(texto: string): { texto: string; href: string; largo: number } | null {
  const cierre = texto.indexOf('](');
  if (cierre < 1 || texto.slice(1, cierre).includes('[')) return null;
  let nivel = 0;
  for (let j = cierre + 2; j < texto.length; j++) {
    const c = texto[j];
    if (/\s/.test(c)) return null;
    if (c === '(') nivel++;
    else if (c === ')') {
      if (nivel === 0) return { texto: texto.slice(1, cierre), href: texto.slice(cierre + 2, j), largo: j + 1 };
      nivel--;
    }
  }
  return null;
}

/** Texto del formato sencillo a html en línea (sin limpiar: el resultado completo pasa por sanitizarHtml). */
function enLinea(texto: string, errores: string[]): string {
  let salida = '';
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    if (resto.startsWith('`')) {
      const fin = texto.indexOf('`', i + 1);
      if (fin > i) {
        salida += `<code>${escaparHtml(texto.slice(i + 1, fin))}</code>`;
        i = fin + 1;
        continue;
      }
    }
    if (resto.startsWith('**')) {
      const fin = texto.indexOf('**', i + 2);
      if (fin > i + 2) {
        salida += `<strong>${enLinea(texto.slice(i + 2, fin), errores)}</strong>`;
        i = fin + 2;
        continue;
      }
    }
    if (resto.startsWith('[')) {
      const m = enlaceEn(resto);
      if (m) {
        if (enlacePermitido(m.href)) salida += `<a href="${escaparHtml(m.href)}">${enLinea(m.texto, errores)}</a>`;
        else {
          errores.push(`El enlace "${m.href}" no está permitido: usa una ruta del sitio (/...), https://, mailto: o tel:.`);
          salida += enLinea(m.texto, errores);
        }
        i += m.largo;
        continue;
      }
    }
    if (resto.startsWith('<')) {
      const m = ETIQUETA_EN_LINEA.exec(resto);
      // Solo las etiquetas de la lista blanca se leen como html; cualquier otra se queda como texto.
      if (m && etiquetaPermitida(/^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(m[0])![1])) {
        salida += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (resto.startsWith('&')) {
      const m = ENTIDAD.exec(resto);
      if (m) {
        salida += m[0];
        i += m[0].length;
        continue;
      }
    }
    salida += escaparHtml(texto[i]);
    i++;
  }
  return salida;
}

/** "Quiénes somos" a "quienes-somos". */
function anclaDe(titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return /^[a-z]/.test(base) ? base : `seccion-${base || 'sin-titulo'}`;
}

/** Texto plano de un título (sin formato): igual en el h2 y en el índice. */
function textoTitulo(titulo: string): string {
  return titulo.trim();
}

/** Etiquetas y atributos que la lista blanca quitaría: se avisan en vez de quitarse en silencio. */
function noPermitidos(html: string): string[] {
  const antes = escribirHtml(leerHtml(html));
  if (antes === sanitizarHtml(html)) return [];
  const nombres = new Set<string>();
  const recorrer = (nodos: Nodo[]) => {
    for (const n of nodos) {
      if (n.tipo !== 'elemento') continue;
      const limpio = leerHtml(sanitizarHtml(escribirHtml([{ ...n, hijos: [] }])));
      const quedo = limpio[0] as NodoElemento | undefined;
      if (!quedo || quedo.nombre !== n.nombre) nombres.add(`<${n.nombre}>`);
      else for (const [k] of n.atributos) if (!quedo.atributos.some(([k2]) => k2 === k) && k.toLowerCase() !== 'rel') nombres.add(`${k} en <${n.nombre}>`);
      recorrer(n.hijos);
    }
  };
  recorrer(leerHtml(html));
  return nombres.size ? [...nombres] : ['contenido que no se permite'];
}

/**
 * Formato sencillo a html del cuerpo (todo lo que va después del encabezado de versión), ya limpio. `errores`
 * vacío = se puede publicar. `secciones` alimenta el índice.
 */
export function marcadoACuerpo(marcado: string): { html: string; secciones: SeccionDocumento[]; errores: string[] } {
  const errores: string[] = [];
  const secciones: SeccionDocumento[] = [];
  const usadas = new Set<string>();
  let html = '';
  let enSeccion = false;
  for (const b of leerBloques(marcado)) {
    switch (b.tipo) {
      case 'seccion': {
        if (enSeccion) html += '</section>';
        const titulo = textoTitulo(b.titulo);
        if (!titulo) errores.push('Cada sección necesita un título después de "## ".');
        let ancla = b.ancla?.trim() || anclaDe(titulo);
        if (b.ancla && !ANCLA.test(b.ancla.trim())) {
          errores.push(`El ancla "{#${b.ancla}}" solo puede llevar letras sin acentos, números y guiones, y empezar con una letra.`);
          ancla = anclaDe(titulo);
        }
        let unica = ancla;
        for (let n = 2; usadas.has(unica); n++) unica = `${ancla}-${n}`;
        usadas.add(unica);
        secciones.push({ id: unica, titulo });
        html +=
          `<section id="${unica}" aria-labelledby="${unica}-titulo" class="mf-terminos__seccion">` +
          `<h2 id="${unica}-titulo"><span class="mf-terminos__num">${secciones.length}.</span> ${escaparHtml(titulo)}</h2>`;
        enSeccion = true;
        break;
      }
      case 'parrafo':
        html += enSeccion ? `<p>${enLinea(b.texto, errores)}</p>` : `<p class="mf-terminos__intro">${enLinea(b.texto, errores)}</p>`;
        break;
      case 'subtitulo':
        html += `<h3>${enLinea(b.texto, errores)}</h3>`;
        break;
      case 'lista': {
        const etiqueta = b.ordenada ? 'ol' : 'ul';
        html += `<${etiqueta}>${b.elementos.map((e) => `<li>${enLinea(e, errores)}</li>`).join('')}</${etiqueta}>`;
        break;
      }
      case 'html':
        html += b.html;
        break;
    }
  }
  if (enSeccion) html += '</section>';
  if (secciones.length === 0) errores.push('El documento necesita al menos una sección: escribe su título con "## " al inicio de la línea.');
  const quitado = noPermitidos(html);
  if (quitado.length) errores.push(`El documento tiene formato que no se permite y no se publicaría: ${quitado.join(', ')}.`);
  return { html: sanitizarHtml(html), secciones, errores: [...new Set(errores)] };
}

function listaIndice(secciones: SeccionDocumento[]): string {
  return (
    '<ol class="mf-terminos__indice-lista">' +
    secciones.map((s, i) => `<li><a href="#${s.id}"><span class="mf-terminos__num">${i + 1}.</span> ${escaparHtml(s.titulo)}</a></li>`).join('') +
    '</ol>'
  );
}

/**
 * El <main> completo de la página (lo que pinta DocumentoLegal con EncabezadoVersion, sin el Header ni el Footer),
 * ya limpio. Es el html que se publica y del que sale el hash.
 */
export function armarDocumento(datos: DatosArmazon, marcado: string): { html: string; secciones: SeccionDocumento[]; errores: string[] } {
  const cuerpo = marcadoACuerpo(marcado);
  const etiqueta = escaparHtml(datos.etiquetaIndice);
  const indice = listaIndice(cuerpo.secciones);
  const encabezado =
    `<p class="${CLASE_ENCABEZADO}" style="color:var(--menu-texto-principal)">${ICONO_VERSION}` +
    `<span>Versión ${escaparHtml(datos.version)}. Vigente desde el <time dateTime="${datos.vigenteDesde}">${fechaVigenciaTexto(datos.vigenteDesde)}</time>.</span></p>`;
  const html =
    '<main class="mf-terminos"><div class="mf-terminos__marco layout-gutter-x"><header class="mf-terminos__cabecera">' +
    `<h1 class="text-elegant-title">${escaparHtml(datos.tituloPagina)}</h1><p class="mf-terminos__marca">Mirú Franco Salón Beauty</p></header>` +
    '<div class="mf-terminos__cuerpo">' +
    `<nav aria-label="${etiqueta}" class="mf-terminos__indice"><p class="mf-terminos__indice-titulo">En esta página</p>${indice}</nav>` +
    `<details class="mf-terminos__plegable"><summary><span>Índice de secciones</span>${ICONO_CHEVRON}</summary><nav aria-label="${etiqueta}">${indice}</nav></details>` +
    `${INICIO_ARTICULO}${encabezado}${cuerpo.html}${FIN_DOCUMENTO}`;
  return { html: sanitizarHtml(html), secciones: cuerpo.secciones, errores: cuerpo.errores };
}

/** El cuerpo de un documento armado: lo que va después del encabezado de versión dentro del <article>. */
export function cuerpoDeDocumento(html: string): string {
  const inicio = html.indexOf(INICIO_ARTICULO);
  if (inicio < 0 || !html.endsWith(FIN_DOCUMENTO)) throw new Error('El html no tiene la estructura de un documento legal.');
  const articulo = html.slice(inicio + INICIO_ARTICULO.length, html.length - FIN_DOCUMENTO.length);
  const finEncabezado = articulo.startsWith(`<p class="${CLASE_ENCABEZADO}"`) ? articulo.indexOf('</p>') + 4 : 0;
  return articulo.slice(finEncabezado);
}

// ---------------------------------------------------------------- Del html al formato sencillo

const BLOQUES_EN_LI = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'h1', 'h2', 'h3', 'h4', 'section', 'blockquote', 'details', 'nav', 'header', 'article']);

const sinAtributos = (n: NodoElemento) => n.atributos.length === 0;

/** Texto plano al formato: escapa lo que el formato leería como marca. */
function textoAMarcado(valor: string): string {
  return valor
    .replace(/\n/g, ' ')
    .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*/g, '&#42;')
    .replace(/`/g, '&#96;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

function enLineaAMarcado(nodos: Nodo[]): string {
  let salida = '';
  for (const n of nodos) {
    if (n.tipo === 'texto') {
      salida += textoAMarcado(n.valor);
      continue;
    }
    const hijosSoloTexto = n.hijos.every((h) => h.tipo === 'texto');
    if (n.nombre === 'strong' && sinAtributos(n) && n.hijos.length > 0) {
      salida += `**${enLineaAMarcado(n.hijos)}**`;
      continue;
    }
    if (n.nombre === 'code' && sinAtributos(n) && hijosSoloTexto) {
      const texto = n.hijos.map((h) => (h.tipo === 'texto' ? h.valor : '')).join('');
      if (texto && !texto.includes('`') && !texto.includes('\n')) {
        salida += `\`${texto}\``;
        continue;
      }
    }
    const href = n.atributos.length === 1 && n.atributos[0][0] === 'href' ? n.atributos[0][1] : null;
    if (n.nombre === 'a' && href && /^[^()\s]+$/.test(href) && enlacePermitido(href)) {
      salida += `[${enLineaAMarcado(n.hijos)}](${href})`;
      continue;
    }
    // Lo demás va como html dentro del texto (por ejemplo, un enlace que abre en otra pestaña).
    const apertura = escribirHtml([{ ...n, hijos: [] }]);
    if (apertura.endsWith('/>')) salida += apertura;
    else salida += `${apertura.slice(0, apertura.length - `</${n.nombre}>`.length)}${enLineaAMarcado(n.hijos)}</${n.nombre}>`;
  }
  return salida;
}

/** Un párrafo no debe empezar como lista, título, bloque html ni con espacios (cambiaría de tipo al volver). */
function protegerInicio(linea: string): string {
  if (/^\s/.test(linea)) return `&#32;${linea.slice(1)}`;
  if (/^#/.test(linea)) return `&#35;${linea.slice(1)}`;
  if (/^-/.test(linea)) return `&#45;${linea.slice(1)}`;
  if (/^\d/.test(linea)) return `&#${linea.charCodeAt(0)};${linea.slice(1)}`;
  return linea;
}

function protegerFinal(linea: string): string {
  // Un espacio al final se perdería al unir líneas: se escribe como entidad.
  return /\s$/.test(linea) ? `${linea.slice(0, -1)}&#32;` : linea;
}

function lineaDe(nodos: Nodo[]): string {
  return protegerFinal(protegerInicio(enLineaAMarcado(nodos)));
}

function soloEnLinea(nodos: Nodo[]): boolean {
  return nodos.every((n) => n.tipo === 'texto' || (!BLOQUES_EN_LI.has(n.nombre) && soloEnLinea(n.hijos)));
}

function bloqueAMarcado(n: Nodo, enIntro: boolean): string {
  if (n.tipo === 'texto') {
    if (!n.valor.trim()) return '';
    throw new Error(`Texto suelto fuera de un párrafo: "${n.valor.slice(0, 40)}"`);
  }
  const esIntro = n.atributos.length === 1 && n.atributos[0][0] === 'class' && n.atributos[0][1] === 'mf-terminos__intro';
  if (n.nombre === 'p' && soloEnLinea(n.hijos) && n.hijos.length > 0 && (enIntro ? esIntro : sinAtributos(n))) return lineaDe(n.hijos);
  if (n.nombre === 'h3' && sinAtributos(n) && soloEnLinea(n.hijos) && n.hijos.length > 0) return `### ${protegerFinal(enLineaAMarcado(n.hijos))}`;
  if ((n.nombre === 'ul' || n.nombre === 'ol') && sinAtributos(n) && n.hijos.length > 0) {
    const elementos = n.hijos.filter((h) => h.tipo === 'elemento') as NodoElemento[];
    const limpios = n.hijos.every((h) => h.tipo === 'elemento' && h.nombre === 'li' && sinAtributos(h) && h.hijos.length > 0 && soloEnLinea(h.hijos));
    if (limpios) return elementos.map((li, i) => `${n.nombre === 'ol' ? `${i + 1}.` : '-'} ${protegerFinal(enLineaAMarcado(li.hijos))}`).join('\n');
  }
  const html = escribirHtml([n]);
  if (!esBloqueHtml(html)) throw new Error(`No se puede expresar este bloque en el formato sencillo: ${html.slice(0, 60)}`);
  return html;
}

/**
 * Html del cuerpo (lo que devuelve cuerpoDeDocumento) al formato sencillo. Lo que el formato no expresa queda como
 * html: marcadoACuerpo(cuerpoAMarcado(cuerpo)) da el mismo html. Sirve para sembrar la plantilla de las versiones
 * publicadas antes del editor y para preparar un borrador desde una versión.
 */
export function cuerpoAMarcado(cuerpoHtml: string): string {
  const bloques: string[] = [];
  let enIntro = true;
  for (const n of leerHtml(cuerpoHtml)) {
    if (n.tipo === 'elemento' && n.nombre === 'section') {
      enIntro = false;
      const [h2, ...resto] = n.hijos;
      const id = n.atributos.find(([k]) => k === 'id')?.[1] ?? '';
      if (!h2 || h2.tipo !== 'elemento' || h2.nombre !== 'h2') throw new Error(`La sección "${id}" no empieza con su título.`);
      const titulo = h2.hijos
        .filter((h) => h.tipo === 'texto')
        .map((h) => (h as { valor: string }).valor)
        .join('')
        .replace(/^ /, '');
      bloques.push(`## ${titulo} {#${id}}`);
      for (const hijo of resto) {
        const b = bloqueAMarcado(hijo, false);
        if (b) bloques.push(b);
      }
      continue;
    }
    if (!enIntro) throw new Error('Hay contenido después de las secciones.');
    const b = bloqueAMarcado(n, true);
    if (b) bloques.push(b);
  }
  return bloques.join('\n\n');
}
