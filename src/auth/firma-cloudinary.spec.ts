import { INestApplication, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { crearFirma, crearFirmaSubidaFoto, firmarParametrosCloudinary } from './firma-cloudinary';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';

// Cada RateLimitGuard arranca un setInterval de limpieza al importarse el controlador: se le quita
// el poder de mantener vivo el proceso (unref) para que Jest termine.
const setIntervalOriginal = global.setInterval;
jest
  .spyOn(global, 'setInterval')
  .mockImplementation(((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    setIntervalOriginal(fn, ms, ...args).unref()) as unknown as typeof setInterval);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthController } = require('./auth.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService } = require('./auth.service');

// Valores falsos: nunca se llama a la API de Cloudinary.
const NUBE = 'nube-de-prueba';
const CLAVE = '000000000000000';
const SECRETO = 'secreto-falso-de-prueba';
const VARIABLES = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;

const originales = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));
function ponerVariables(valores: Partial<Record<(typeof VARIABLES)[number], string>>) {
  for (const v of VARIABLES) {
    if (valores[v] === undefined) delete process.env[v];
    else process.env[v] = valores[v];
  }
}
const completas = { CLOUDINARY_CLOUD_NAME: NUBE, CLOUDINARY_API_KEY: CLAVE, CLOUDINARY_API_SECRET: SECRETO };

afterAll(() => {
  for (const v of VARIABLES) {
    if (originales[v] === undefined) delete process.env[v];
    else process.env[v] = originales[v];
  }
});

describe('firmarParametrosCloudinary (ejemplos de la documentación oficial)', () => {
  // https://cloudinary.com/documentation/authentication_signatures
  it('solo timestamp: timestamp=1315060510 con secreto abcd', () => {
    expect(firmarParametrosCloudinary({ timestamp: '1315060510' }, 'abcd')).toBe(
      'a21ad0f63beb4de2e5575204b79ab90bffb02c10',
    );
  });

  it('varios parámetros: los ordena por nombre y los une con &', () => {
    expect(
      firmarParametrosCloudinary(
        { timestamp: '1315060510', public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' },
        'abcd',
      ),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });
});

describe('crearFirmaSubidaFoto', () => {
  // Con milisegundos: el timestamp debe ir en segundos enteros.
  const ahora = Date.UTC(2026, 9, 7, 12, 0, 0) + 999;

  it('firma los parámetros fijos de la foto del usuario y entrega lo que el cliente manda a Cloudinary', () => {
    ponerVariables(completas);
    const r = crearFirmaSubidaFoto('abc-123', ahora);

    expect(r.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${NUBE}/image/upload`);
    expect(r.apiKey).toBe(CLAVE);
    expect(r.params).toEqual({
      allowed_formats: 'jpg,jpeg,png,webp,gif,avif,heic',
      folder: 'avatares',
      invalidate: 'true',
      overwrite: 'true',
      public_id: 'usuario_abc-123',
      timestamp: String(Date.UTC(2026, 9, 7, 12, 0, 0) / 1000),
      transformation: 'c_limit,w_1024,h_1024',
    });
    expect(r.signature).toBe(firmarParametrosCloudinary(r.params, SECRETO));
    expect(r.signature).toMatch(/^[0-9a-f]{40}$/);
  });

  it('la respuesta nunca contiene el secreto', () => {
    ponerVariables(completas);
    expect(JSON.stringify(crearFirmaSubidaFoto('abc-123', ahora))).not.toContain(SECRETO);
  });

  it.each(VARIABLES)('sin %s responde 503 en español, no firma y no registra el secreto', (falta) => {
    ponerVariables({ ...completas, [falta]: undefined });
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let error: unknown;
    try {
      crearFirmaSubidaFoto('abc-123', ahora);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).message).toBe('La subida de fotos no está disponible por ahora.');
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRETO);
    log.mockRestore();
  });
});

describe('POST /api/auth/me/foto/firma', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // AuthService real: firmaSubidaFoto no usa sus dependencias.
    const authService = new AuthService({}, {}, {}, {}, {});
    const modulo = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx: any) => ((ctx.switchToHttp().getRequest().user = { id: 'clienta-1' }), true) })
      .compile();
    app = modulo.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = () => fetch(`${base}/api/auth/me/foto/firma`, { method: 'POST' });

  it('exige sesión (JwtAuthGuard) y límite de solicitudes (RateLimitGuard)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.firmaSubidaFoto);
    expect(guards[0]).toBe(JwtAuthGuard);
    expect(guards[1]).toBeInstanceOf(RateLimitGuard);
  });

  it('con sesión devuelve la firma para el usuario de la sesión, sin el secreto', async () => {
    ponerVariables(completas);
    const res = await pedir();
    const texto = await res.text();
    expect(res.status).toBe(200);
    expect(texto).not.toContain(SECRETO);
    const cuerpo = JSON.parse(texto);
    expect(cuerpo.success).toBe(true);
    expect(cuerpo.data.params.public_id).toBe('usuario_clienta-1');
    expect(cuerpo.data.signature).toBe(firmarParametrosCloudinary(cuerpo.data.params, SECRETO));
  });

  it('sin variables de Cloudinary responde 503 con mensaje en español', async () => {
    ponerVariables({});
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = await pedir();
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe('La subida de fotos no está disponible por ahora.');
    log.mockRestore();
  });

  it('a la solicitud 11 dentro de un minuto responde 429', async () => {
    ponerVariables(completas);
    // Se vacía el contador del guard para no depender de las solicitudes de otras pruebas.
    const limite = Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.firmaSubidaFoto)[1];
    limite.requests.clear();
    const estados: number[] = [];
    for (let i = 0; i < 11; i++) estados.push((await pedir()).status);
    expect(estados).toEqual([...Array(10).fill(200), 429]);
  });
});

// Calculado aparte con: node -e "crypto.createHash('sha1').update('<cadena>' + secreto).digest('hex')"
const FIRMA_GALERIA_CONOCIDA = 'a93f2d3e8d2570e7aeb495067eefee0898183129';

describe('crearFirma por uso', () => {
  const ahora = Date.UTC(2026, 9, 7, 12, 0, 0);
  const timestamp = String(ahora / 1000);

  it('perfil: lo mismo que la foto de perfil (avatares/usuario_<id>)', () => {
    ponerVariables(completas);
    expect(crearFirma('perfil', 'abc-123', ahora)).toEqual(crearFirmaSubidaFoto('abc-123', ahora));
  });

  it('galeria: carpeta fija galeria, los formatos de imagen de antes (incluidos gif, avif, heic) y sin public_id ni overwrite', () => {
    ponerVariables(completas);
    const r = crearFirma('galeria', 'admin-1', ahora);
    expect(r.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${NUBE}/image/upload`);
    expect(r.apiKey).toBe(CLAVE);
    expect(r.params).toEqual({ allowed_formats: 'jpg,jpeg,png,webp,gif,avif,heic,heif', folder: 'galeria', timestamp });
    expect(r.signature).toBe(firmarParametrosCloudinary(r.params, SECRETO));
  });

  it('factura: carpeta fija facturas, solo PDF, por image/upload como hoy', () => {
    ponerVariables(completas);
    const r = crearFirma('factura', 'admin-1', ahora);
    expect(r.uploadUrl).toBe(`https://api.cloudinary.com/v1_1/${NUBE}/image/upload`);
    expect(r.params).toEqual({ allowed_formats: 'pdf', folder: 'facturas', timestamp });
    expect(r.signature).toBe(firmarParametrosCloudinary(r.params, SECRETO));
  });

  it('firma con vector conocido (SHA-1 de la cadena ordenada + secreto)', () => {
    ponerVariables(completas);
    const r = crearFirma('galeria', 'admin-1', ahora);
    // sha1("allowed_formats=jpg,jpeg,png,webp,gif,avif,heic,heif&folder=galeria&timestamp=1791374400secreto-falso-de-prueba")
    expect(r.signature).toBe(FIRMA_GALERIA_CONOCIDA);
  });

  it('ningún uso devuelve el secreto', () => {
    ponerVariables(completas);
    for (const uso of ['perfil', 'galeria', 'factura'] as const) {
      expect(JSON.stringify(crearFirma(uso, 'abc-123', ahora))).not.toContain(SECRETO);
    }
  });

  it('sin variables de Cloudinary responde 503 también en galería', () => {
    ponerVariables({});
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(() => crearFirma('galeria', 'admin-1', ahora)).toThrow(ServiceUnavailableException);
    log.mockRestore();
  });
});
