import sharp from 'sharp';
import { DbService } from './db.service';

/** SVG como el que produce mermaid para un erDiagram (cajas y texto). */
const SVG_DIAGRAMA = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect x="10" y="10" width="120" height="60" fill="#eee" stroke="#999"/>
  <text x="20" y="45" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#333">Usuario</text>
  <rect x="190" y="110" width="120" height="60" fill="#eee" stroke="#999"/>
  <text x="200" y="145" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#333">Cita</text>
  <path d="M130 40 L190 140" stroke="#666" fill="none"/>
</svg>`;

const FIRMA_PNG = '89504e470d0a1a0a';

describe('Diagrama ER en PNG (sharp)', () => {
  const servicio = new DbService({} as any);

  it('svgToPng convierte el SVG a un PNG válido con el tamaño del SVG', async () => {
    const png: Buffer = await (servicio as any).svgToPng(SVG_DIAGRAMA);

    expect(png.subarray(0, 8).toString('hex')).toBe(FIRMA_PNG);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([320, 180]);
  });

  it('generarDiagrama("png") (GET /api/db/diagram?formato=png) devuelve un PNG adjunto', async () => {
    // mermaid.render necesita un DOM: en Node no corre, así que se sustituye por el SVG de arriba.
    jest.spyOn(servicio as any, 'renderMermaidToSvg').mockResolvedValue(SVG_DIAGRAMA);

    const { buffer, filename, contentType } = await servicio.generarDiagrama('png');

    expect(contentType).toBe('image/png');
    expect(filename).toMatch(/^diagrama-er_\d{4}-\d{2}-\d{2}\.png$/);
    expect(buffer.subarray(0, 8).toString('hex')).toBe(FIRMA_PNG);
  });

  it('formato=mermaid devuelve el código del esquema de Prisma', async () => {
    const { buffer, contentType } = await servicio.generarDiagrama('mermaid');

    expect(contentType).toBe('text/plain');
    expect(buffer.toString('utf-8')).toContain('erDiagram');
  });
});
