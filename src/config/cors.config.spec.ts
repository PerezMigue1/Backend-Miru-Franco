import { Test } from '@nestjs/testing';
import { construirOrigenesPermitidos, crearCorsOptions, crearRechazoPreflight } from './cors.config';

type OrigenCallback = (err: Error | null, permitido?: boolean) => void;

function evaluar(env: NodeJS.ProcessEnv, origin: string | undefined): boolean | undefined {
  const origen = crearCorsOptions(env).origin as (o: string | undefined, cb: OrigenCallback) => void;
  let resultado: boolean | undefined;
  origen(origin, (_err, permitido) => {
    resultado = permitido;
  });
  return resultado;
}

describe('cors.config', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

  it('en producción solo acepta el dominio propio del frontend', () => {
    expect(evaluar(prod, 'https://www.mirufranco.com')).toBe(true);
    expect(evaluar(prod, 'https://mirufranco.com')).toBe(true);
    expect(evaluar(prod, 'https://sitio-malicioso.com')).toBe(false);
    expect(evaluar(prod, 'http://localhost:3000')).toBe(false);
    expect(evaluar(prod, 'https://miru-franco.vercel.app')).toBe(false);
    expect(evaluar(prod, 'null')).toBe(false);
  });

  it('peticiones sin Origin (servidor a servidor) no se bloquean', () => {
    expect(evaluar(prod, undefined)).toBe(true);
  });

  it('fuera de producción acepta el frontend local', () => {
    expect(evaluar({ NODE_ENV: 'development' } as NodeJS.ProcessEnv, 'http://localhost:3000')).toBe(true);
  });

  it('agrega FRONTEND_URL y CORS_ALLOWED_ORIGINS normalizados, e ignora comodines', () => {
    const origenes = construirOrigenesPermitidos({
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://www.mirufranco.com/',
      CORS_ALLOWED_ORIGINS: ' https://miru-franco.vercel.app , *, no-es-url, http://192.168.1.10:3000/ ',
    } as NodeJS.ProcessEnv);

    expect([...origenes].sort()).toEqual(
      [
        'https://www.mirufranco.com',
        'https://mirufranco.com',
        'https://miru-franco.vercel.app',
        'http://192.168.1.10:3000',
      ].sort(),
    );
  });

  it('FRONTEND_URL="*" ya no abre CORS a cualquier origen', () => {
    expect(evaluar({ NODE_ENV: 'production', FRONTEND_URL: '*' } as NodeJS.ProcessEnv, 'https://sitio-malicioso.com')).toBe(false);
  });

  it('mantiene credenciales y las cabeceras que usa el frontend (X-Auth-Mode, Last-Event-ID)', () => {
    const opciones = crearCorsOptions(prod);
    expect(opciones.credentials).toBe(true);
    expect(opciones.allowedHeaders).toEqual(expect.arrayContaining(['X-Auth-Mode', 'Last-Event-ID', 'Authorization']));
  });
});

describe('preflight (OPTIONS) con la app real', () => {
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  let app: any;
  let base: string;

  beforeAll(async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const modulo = await Test.createTestingModule({}).compile();
    app = modulo.createNestApplication({ logger: false });
    app.use(crearRechazoPreflight(prod));
    app.enableCors(crearCorsOptions(prod));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origin: string) =>
    fetch(`${base}/api/pregunta-seguridad`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type,x-auth-mode' },
    });

  it('un origen permitido recibe 204 con cabeceras CORS', async () => {
    const r = await preflight('https://www.mirufranco.com');
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://www.mirufranco.com');
    // El navegador reutiliza el preflight 10 min en vez de repetirlo antes de cada petición.
    expect(r.headers.get('access-control-max-age')).toBe('600');
  });

  it('un origen no permitido recibe 403, sin cabeceras CORS', async () => {
    const r = await preflight('http://localhost:3100');
    expect(r.status).toBe(403);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});
