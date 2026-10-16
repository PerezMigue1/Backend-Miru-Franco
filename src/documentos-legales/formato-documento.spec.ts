import { armarDocumento, cuerpoAMarcado, cuerpoDeDocumento, fechaVigenciaTexto, marcadoACuerpo } from './formato-documento';
import { textoVisible } from './html-seguro';

const DATOS = { tituloPagina: 'Política de prueba', etiquetaIndice: 'Índice de la prueba', version: '1.1', vigenteDesde: '2026-10-20' };

describe('fechaVigenciaTexto', () => {
  it('escribe el día como la web (es-MX, sin desfase de zona)', () => {
    expect(fechaVigenciaTexto('2026-10-14')).toBe('14 de octubre de 2026');
    expect(fechaVigenciaTexto('2027-01-01')).toBe('1 de enero de 2027');
  });
});

describe('marcadoACuerpo: formato sencillo a html con las clases de DocumentoLegal', () => {
  it('párrafo de introducción, secciones numeradas con ancla, subtítulos y listas', () => {
    const { html, secciones, errores } = marcadoACuerpo(
      [
        'Bienvenida. Lee con calma.',
        '',
        '## Quiénes somos {#quienes-somos}',
        '',
        'Somos un **salón** en [Huejutla](/contacto).',
        '',
        '### Pagos',
        '',
        '1. En línea',
        '2. En el salón',
        '',
        '## Garantía',
        '',
        '- Uno',
        '- Dos',
        '  sigue el dos',
      ].join('\n'),
    );
    expect(errores).toEqual([]);
    expect(secciones).toEqual([
      { id: 'quienes-somos', titulo: 'Quiénes somos' },
      { id: 'garantia', titulo: 'Garantía' },
    ]);
    expect(html).toBe(
      '<p class="mf-terminos__intro">Bienvenida. Lee con calma.</p>' +
        '<section id="quienes-somos" aria-labelledby="quienes-somos-titulo" class="mf-terminos__seccion"><h2 id="quienes-somos-titulo"><span class="mf-terminos__num">1.</span> Quiénes somos</h2>' +
        '<p>Somos un <strong>salón</strong> en <a href="/contacto">Huejutla</a>.</p><h3>Pagos</h3><ol><li>En línea</li><li>En el salón</li></ol></section>' +
        '<section id="garantia" aria-labelledby="garantia-titulo" class="mf-terminos__seccion"><h2 id="garantia-titulo"><span class="mf-terminos__num">2.</span> Garantía</h2>' +
        '<ul><li>Uno</li><li>Dos sigue el dos</li></ul></section>',
    );
  });

  it('dos líneas seguidas son un solo párrafo y el texto se escapa', () => {
    const { html } = marcadoACuerpo('## A\n\nUno "dos"\ny <tres> & cuatro');
    expect(html).toContain('<p>Uno &quot;dos&quot; y &lt;tres&gt; &amp; cuatro</p>');
  });

  it('un enlace que no es interno, https, mailto o tel es un error', () => {
    const { errores, html } = marcadoACuerpo('## A\n\nVe a [aquí](javascript:alert(1)).');
    expect(errores.join(' ')).toMatch(/enlace/i);
    expect(html).not.toContain('javascript');
  });

  it('un bloque con formato especial (html) se conserva limpio; lo no permitido es un error', () => {
    const bien = marcadoACuerpo('## A\n\n<div class="mf-card"><dl><dt>Hola</dt><dd>Mundo</dd></dl></div>');
    expect(bien.errores).toEqual([]);
    expect(bien.html).toContain('<div class="mf-card"><dl><dt>Hola</dt><dd>Mundo</dd></dl></div>');
    const mal = marcadoACuerpo('## A\n\n<div onclick="x()">Hola<script>alert(1)</script></div>');
    expect(mal.errores.join(' ')).toMatch(/no se permite/i);
    expect(mal.html).not.toMatch(/script|onclick/);
  });

  it('sin ninguna sección es un error', () => {
    expect(marcadoACuerpo('Solo un párrafo').errores.join(' ')).toMatch(/sección/);
  });

  it('dos secciones con el mismo título reciben anclas distintas', () => {
    const { secciones } = marcadoACuerpo('## Cambios\n\nA\n\n## Cambios\n\nB');
    expect(secciones.map((s) => s.id)).toEqual(['cambios', 'cambios-2']);
  });
});

describe('armarDocumento y cuerpoDeDocumento', () => {
  it('arma el <main> de DocumentoLegal con el índice dos veces y el encabezado de versión', () => {
    const { html, errores } = armarDocumento(DATOS, '## Uno {#uno}\n\nTexto.');
    expect(errores).toEqual([]);
    const t = textoVisible(html);
    // Sin espacios entre elementos pegados, igual que el html que pinta React.
    expect(t).toBe(
      'Política de pruebaMirú Franco Salón BeautyEn esta página1. UnoÍndice de secciones1. Uno' +
        'Versión 1.1. Vigente desde el 20 de octubre de 2026.1. UnoTexto.',
    );
    expect(html).toContain('<time dateTime="2026-10-20">20 de octubre de 2026</time>');
    expect(html.startsWith('<main class="mf-terminos">')).toBe(true);
  });

  it('cuerpoDeDocumento devuelve lo que va después del encabezado de versión', () => {
    const { html } = armarDocumento(DATOS, '## Uno {#uno}\n\nTexto.');
    expect(cuerpoDeDocumento(html)).toBe(marcadoACuerpo('## Uno {#uno}\n\nTexto.').html);
  });
});

describe('cuerpoAMarcado: del html publicado al formato sencillo, sin perder texto', () => {
  it('ida y vuelta da el mismo html', () => {
    const marcado = [
      'Intro con [enlace](https://www.gob.mx/profeco).',
      '',
      '## Uno {#uno}',
      '',
      '**Negritas:** y `codigo` con {diasGarantia} días.',
      '',
      '- a',
      '- b',
      '',
      '### Sub',
      '',
      '1. x',
      '2. y',
    ].join('\n');
    const html = marcadoACuerpo(marcado).html;
    expect(cuerpoAMarcado(html)).toBe(marcado);
    expect(marcadoACuerpo(cuerpoAMarcado(html)).html).toBe(html);
  });

  it('lo que el formato sencillo no expresa queda como html dentro del texto o como bloque especial', () => {
    const html =
      '<section id="q" aria-labelledby="q-titulo" class="mf-terminos__seccion"><h2 id="q-titulo"><span class="mf-terminos__num">1.</span> Q</h2>' +
      '<p>Ver <a href="https://www.gob.mx/profeco" target="_blank" rel="noopener noreferrer">sitio<span class="sr-only"> (se abre en otra pestaña)</span></a> * [x]</p>' +
      '<div class="mf-card"><dl><div><dt>A</dt><dd>B</dd></div></dl></div></section>';
    const marcado = cuerpoAMarcado(html);
    expect(marcadoACuerpo(marcado).html).toBe(html);
  });

  it('un párrafo que empieza como lista o título no cambia de tipo', () => {
    const html = '<section id="q" aria-labelledby="q-titulo" class="mf-terminos__seccion"><h2 id="q-titulo"><span class="mf-terminos__num">1.</span> Q</h2><p>- no es lista</p><p>1. tampoco</p><p>## ni título</p></section>';
    expect(marcadoACuerpo(cuerpoAMarcado(html)).html).toBe(html);
  });
});
