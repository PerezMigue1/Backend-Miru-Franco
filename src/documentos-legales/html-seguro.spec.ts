import { hashTexto, hashTextoVisible, sanitizarHtml, textoVisible } from './html-seguro';

describe('textoVisible: la misma regla del hash que la web (components/legal/paginasLegales.test.ts)', () => {
  it('quita etiquetas, decodifica las entidades de React y colapsa espacios y saltos', () => {
    const a = textoVisible('<p class="x">Hola,\r\n   <strong>mundo</strong> &amp; más</p>');
    const b = textoVisible('<div><span>Hola,</span> <em>mundo</em>\n&amp; más</div>');
    expect(a).toBe('Hola, mundo & más');
    expect(hashTexto(a)).toBe(hashTexto(b));
  });

  it('decodifica &quot; &#x27; &lt; &gt; y &amp; (en ese orden, como la web)', () => {
    expect(textoVisible('<p>&quot;listo&quot; y &#x27;ya&#x27; &lt;b&gt; &amp;amp;</p>')).toBe(`"listo" y 'ya' <b> &amp;`);
  });

  it('dos elementos pegados no llevan espacio entre su texto (igual que la web)', () => {
    expect(textoVisible('<ol><li>a.</li><li>b</li></ol>')).toBe('a.b');
  });

  it('el hash es el SHA-256 hexadecimal en UTF-8 del texto', () => {
    expect(hashTexto('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashTextoVisible('<p> abc </p>')).toBe(hashTexto('abc'));
  });
});

describe('sanitizarHtml: lista blanca estricta', () => {
  it('quita script, style, iframe y su contenido', () => {
    const limpio = sanitizarHtml('<p>a<script>alert(1)</script>b<style>p{}</style>c<iframe src="https://x.com"></iframe></p>');
    expect(limpio).toBe('<p>abc</p>');
  });

  it('quita los atributos on* y los enlaces javascript:, data: o http:', () => {
    expect(sanitizarHtml('<a href="javascript:alert(1)" onclick="x()">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<a href="data:text/html,hola">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<a href="http://otro.com">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<a href="//otro.com">x</a>')).toBe('<a>x</a>');
    expect(sanitizarHtml('<p onmouseover="x()">x</p>')).toBe('<p>x</p>');
  });

  it('conserva enlaces internos, https, mailto y tel', () => {
    for (const href of ['/politica-de-reembolsos', '#anticipos', 'https://www.gob.mx/profeco', 'mailto:a@b.com', 'tel:+527711867645']) {
      expect(sanitizarHtml(`<a href="${href}">x</a>`)).toBe(`<a href="${href}">x</a>`);
    }
  });

  it('target="_blank" siempre lleva rel="noopener noreferrer"', () => {
    expect(sanitizarHtml('<a href="https://x.com" target="_blank">x</a>')).toBe('<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('una etiqueta que no está en la lista se quita pero su texto se queda', () => {
    expect(sanitizarHtml('<p><font color="red">hola</font> <img src="x" onerror="y()"></p>')).toBe('<p>hola </p>');
  });

  it('style solo con variables del sistema (sin url ni expresiones)', () => {
    expect(sanitizarHtml('<p style="color:var(--menu-texto-principal)">x</p>')).toBe('<p style="color:var(--menu-texto-principal)">x</p>');
    expect(sanitizarHtml('<p style="background:url(https://x.com/a.png)">x</p>')).toBe('<p>x</p>');
    expect(sanitizarHtml('<p style="color:red;position:fixed">x</p>')).toBe('<p>x</p>');
  });

  it('svg de íconos sí, pero sin foreignObject, use ni href', () => {
    const icono = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
    expect(sanitizarHtml(icono)).toBe(icono);
    expect(sanitizarHtml('<svg><foreignObject><p>x</p></foreignObject><use href="#a"></use></svg>')).toBe('<svg></svg>');
  });

  it('escapa el texto como React y cierra las etiquetas abiertas', () => {
    expect(sanitizarHtml('<p>"a" & \'b\' < c')).toBe('<p>&quot;a&quot; &amp; &#x27;b&#x27; &lt; c</p>');
    expect(sanitizarHtml('<p>a</div>b</p>')).toBe('<p>ab</p>');
  });

  it('no cambia el texto visible de un html que ya es seguro', () => {
    const html = '<section id="a" class="mf-terminos__seccion"><h2 id="a-titulo">Hola &amp; adiós</h2><p>Uno<br/>dos <time dateTime="2026-10-14">hoy</time></p></section>';
    const limpio = sanitizarHtml(html);
    expect(textoVisible(limpio)).toBe(textoVisible(html));
    expect(limpio).toContain('dateTime="2026-10-14"');
  });

  it('quita los comentarios', () => {
    expect(sanitizarHtml('<p>a<!-- <script>x</script> -->b</p>')).toBe('<p>ab</p>');
  });
});
