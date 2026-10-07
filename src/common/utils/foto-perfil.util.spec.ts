import { esFotoPerfilPermitida } from './foto-perfil.util';

const NUBE = 'nube-de-prueba';
const PROPIA = `https://res.cloudinary.com/${NUBE}/image/upload/v1719307544/avatares/usuario_1.jpg`;
const GOOGLE = 'https://lh3.googleusercontent.com/a/foto-de-google=s96-c';

describe('esFotoPerfilPermitida', () => {
  describe('acepta', () => {
    it('null y cadena vacía (quitar la foto)', () => {
      expect(esFotoPerfilPermitida(null, { cloudName: NUBE, fotoActual: GOOGLE })).toBe(true);
      expect(esFotoPerfilPermitida('', { cloudName: NUBE, fotoActual: GOOGLE })).toBe(true);
      expect(esFotoPerfilPermitida('   ', { cloudName: NUBE, fotoActual: null })).toBe(true);
    });

    it('una imagen subida a la cuenta propia de Cloudinary', () => {
      expect(esFotoPerfilPermitida(PROPIA, { cloudName: NUBE, fotoActual: null })).toBe(true);
    });

    it('el mismo valor que ya tiene guardado (foto de Google o anterior)', () => {
      expect(esFotoPerfilPermitida(GOOGLE, { cloudName: NUBE, fotoActual: GOOGLE })).toBe(true);
      expect(esFotoPerfilPermitida(` ${GOOGLE} `, { cloudName: NUBE, fotoActual: GOOGLE })).toBe(true);
    });

    it('sin cloud_name configurado: solo null, vacío o el valor guardado', () => {
      expect(esFotoPerfilPermitida(null, { cloudName: undefined, fotoActual: null })).toBe(true);
      expect(esFotoPerfilPermitida('', { cloudName: '', fotoActual: null })).toBe(true);
      expect(esFotoPerfilPermitida(GOOGLE, { cloudName: undefined, fotoActual: GOOGLE })).toBe(true);
      expect(esFotoPerfilPermitida(PROPIA, { cloudName: undefined, fotoActual: null })).toBe(false);
      expect(esFotoPerfilPermitida(PROPIA, { cloudName: '', fotoActual: null })).toBe(false);
    });
  });

  describe('rechaza', () => {
    const opciones = { cloudName: NUBE, fotoActual: GOOGLE };

    it.each([
      ['http', `http://res.cloudinary.com/${NUBE}/image/upload/v1/a.jpg`],
      ['otro host', `https://evil.com/${NUBE}/image/upload/v1/a.jpg`],
      ['otro cloud_name', 'https://res.cloudinary.com/otra-nube/image/upload/v1/a.jpg'],
      ['cloud_name como prefijo de otro', `https://res.cloudinary.com/${NUBE}x/image/upload/v1/a.jpg`],
      ['host parecido', `https://res.cloudinary.com.evil.com/${NUBE}/image/upload/v1/a.jpg`],
      ['subdominio parecido', `https://evilres.cloudinary.com/${NUBE}/image/upload/v1/a.jpg`],
      ['host con punto final', `https://res.cloudinary.com./${NUBE}/image/upload/v1/a.jpg`],
      ['usuario en la URL', `https://res.cloudinary.com@evil.com/${NUBE}/image/upload/v1/a.jpg`],
      ['credenciales antes del host', `https://x:y@res.cloudinary.com/${NUBE}/image/upload/v1/a.jpg`],
      ['puerto distinto', `https://res.cloudinary.com:8443/${NUBE}/image/upload/v1/a.jpg`],
      ['ruta de video', `https://res.cloudinary.com/${NUBE}/video/upload/v1/a.mp4`],
      ['ruta raw', `https://res.cloudinary.com/${NUBE}/raw/upload/v1/a.jpg`],
      ['sin archivo tras upload/', `https://res.cloudinary.com/${NUBE}/image/upload/`],
      ['salto de carpeta con ..', `https://res.cloudinary.com/${NUBE}/image/upload/../../otra-nube/image/upload/a.jpg`],
      // Formas que `URL` normaliza a la cuenta propia, pero que se guardarían tal como llegan.
      ['diagonales invertidas', `https:\\\\res.cloudinary.com\\${NUBE}\\image\\upload\\a.jpg`],
      ['sin // tras https:', `https:res.cloudinary.com/${NUBE}/image/upload/a.jpg`],
      ['arroba vacía antes del host', `https://@res.cloudinary.com/${NUBE}/image/upload/a.jpg`],
      ['host con letras de ancho completo', `https://ｒｅｓ.cloudinary.com/${NUBE}/image/upload/a.jpg`],
      ['salto de línea dentro del host', `https://res.cloud\ninary.com/${NUBE}/image/upload/a.jpg`],
      ['comillas y etiquetas en la ruta', `https://res.cloudinary.com/${NUBE}/image/upload/a.jpg"><script>`],
      ['puerto 443 explícito', `https://res.cloudinary.com:443/${NUBE}/image/upload/a.jpg`],
      ['URL mal formada', 'https://'],
      ['texto que no es URL', 'no es una url'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:image/png;base64,AAAA'],
    ])('%s', (_caso, valor) => {
      expect(esFotoPerfilPermitida(valor, opciones)).toBe(false);
    });
  });
});
