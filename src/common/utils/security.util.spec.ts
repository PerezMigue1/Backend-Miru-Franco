import * as bcrypt from 'bcryptjs';
import { escaparHtml, formaEscapadaAnterior, sanitizeInput } from './security.util';
import { UsuariosService } from '../../usuarios/usuarios.service';

describe('sanitizeInput', () => {
  it('guarda el texto tal cual: no escapa URLs, comillas ni etiquetas', () => {
    const url = 'https://res.cloudinary.com/miru-franco/image/upload/v1/productos/goji.webp';
    expect(sanitizeInput(url)).toBe(url);
    expect(sanitizeInput(`"suave" y d'Argan <3`)).toBe(`"suave" y d'Argan <3`);
  });

  it('solo quita el byte nulo y los espacios de los extremos', () => {
    expect(sanitizeInput('  texto\u0000 limpio  ')).toBe('texto limpio');
    expect(sanitizeInput(undefined as any)).toBe('');
  });
});

describe('escaparHtml (al mostrar)', () => {
  it('escapa lo necesario para meter texto en HTML', () => {
    expect(escaparHtml(`<img src=x onerror="a('b')"> & más`)).toBe(
      '&lt;img src=x onerror=&quot;a(&#x27;b&#x27;)&quot;&gt; &amp; más',
    );
  });
});

describe('Respuesta de seguridad registrada con el escape anterior', () => {
  function servicioCon(hash: string) {
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u-1', email: 'u@example.com', respuestaSeguridad: hash }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return new UsuariosService(prisma as any, {} as any, {} as any, {} as any);
  }

  it('sigue validando aunque el hash se haya hecho sobre el texto escapado', async () => {
    const respuesta = "Firulais d'Oro";
    const hashAnterior = await bcrypt.hash(formaEscapadaAnterior(respuesta), 4);
    await expect(servicioCon(hashAnterior).validarRespuestaSeguridad('u@example.com', respuesta)).resolves.toMatchObject({
      success: true,
    });
  });

  it('valida las respuestas nuevas, guardadas tal cual', async () => {
    const respuesta = "Firulais d'Oro";
    const hash = await bcrypt.hash(respuesta, 4);
    await expect(servicioCon(hash).validarRespuestaSeguridad('u@example.com', respuesta)).resolves.toMatchObject({
      success: true,
    });
  });

  it('rechaza una respuesta incorrecta', async () => {
    const hash = await bcrypt.hash("Firulais d'Oro", 4);
    await expect(servicioCon(hash).validarRespuestaSeguridad('u@example.com', 'Otra')).rejects.toThrow('Respuesta incorrecta');
  });
});
