import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { firmarParametrosCloudinary } from '../auth/firma-cloudinary';

const logger = new Logger('CloudinaryGaleria');

/** Carpeta de la galería (firma `galeria` de POST /api/subidas/firma) y la de imágenes ilustrativas. */
export const CARPETA_GALERIA = 'galeria';
export const CARPETA_ILUSTRATIVAS = 'galeria/ilustrativas';

/** Los formatos que acepta el panel (JPG, PNG o WebP). */
const FORMATOS_PANEL = 'jpg,jpeg,png,webp';

/**
 * Firma de una sola subida con el public_id que eligió el servidor (sin carpeta ni nombre del cliente) y sin
 * sobrescribir. El cliente manda a `uploadUrl` el archivo con api_key, signature y `params` tal cual. El secreto
 * nunca sale.
 */
export function crearFirmaFotoGaleria(publicId: string, ahoraMs: number = Date.now()) {
  const nube = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !apiKey || !secreto) {
    logger.error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET');
    throw new ServiceUnavailableException('La subida de fotos no está disponible por ahora.');
  }
  const params: Record<string, string> = {
    allowed_formats: FORMATOS_PANEL,
    overwrite: 'false',
    public_id: publicId,
    timestamp: String(Math.floor(ahoraMs / 1000)),
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(nube)}/image/upload`,
    apiKey,
    params,
    signature: firmarParametrosCloudinary(params, secreto),
  };
}

/** Datos de una imagen en Cloudinary que necesita el servidor para armar su URL pública. */
export interface RecursoCloudinary {
  version: number;
  format: string;
}

/**
 * La imagen `publicId` en Cloudinary (API de administración, autenticada con la llave y el secreto): su versión y
 * formato, o null si no existe. Un error de red o de Cloudinary lanza.
 */
export async function consultarRecursoCloudinary(publicId: string, fetchImpl: typeof fetch = fetch): Promise<RecursoCloudinary | null> {
  const nube = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !apiKey || !secreto) throw new Error('Cloudinary no está configurado');
  const ruta = publicId.split('/').map(encodeURIComponent).join('/');
  const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(nube)}/resources/image/upload/${ruta}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secreto}`).toString('base64')}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Cloudinary no respondió la consulta de la imagen (HTTP ${res.status})`);
  const datos = (await res.json().catch(() => ({}))) as { public_id?: unknown; version?: unknown; format?: unknown };
  if (datos.public_id !== publicId || typeof datos.version !== 'number' || typeof datos.format !== 'string' || !/^[a-z0-9]+$/i.test(datos.format)) {
    throw new Error('Cloudinary devolvió datos inesperados de la imagen');
  }
  return { version: datos.version, format: datos.format.toLowerCase() };
}

/** URL pública de una imagen de la galería, armada por el servidor (nunca la manda el cliente). */
export function urlPublicaGaleria(publicId: string, recurso: RecursoCloudinary, nube = process.env.CLOUDINARY_CLOUD_NAME): string {
  return `https://res.cloudinary.com/${nube}/image/upload/v${recurso.version}/${publicId}.${recurso.format}`;
}

/**
 * Valida que `valor` sea una imagen subida a la carpeta de galería de la cuenta propia de Cloudinary
 * (`https://res.cloudinary.com/<nube>/image/upload/[v123/]galeria/...`) y devuelve su public_id (la ruta sin la
 * versión ni la extensión). La forma debe ser canónica: https, sin puerto, credenciales, query ni fragmento, y sin
 * %2F, %5C ni %2E sueltos (nadie salta de carpeta). Sin `nube` configurada no acepta nada.
 */
export function validarUrlGaleria(valor: unknown, nube: string | undefined): { publicId: string; enIlustrativas: boolean } | null {
  if (typeof valor !== 'string' || !nube) return null;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return null;
  }
  if (
    u.href !== valor ||
    u.protocol !== 'https:' ||
    u.hostname !== 'res.cloudinary.com' ||
    u.port !== '' ||
    u.username !== '' ||
    u.password !== '' ||
    u.search !== '' ||
    u.hash !== '' ||
    valor.includes('?') ||
    valor.includes('#') ||
    /%(2f|5c|2e)/i.test(u.pathname)
  ) {
    return null;
  }
  const prefijo = `/${nube}/image/upload/`;
  if (!u.pathname.startsWith(prefijo)) return null;
  const ruta = u.pathname.slice(prefijo.length).replace(/^v\d+\//, '');
  const m = /^(galeria\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+?)\.([A-Za-z0-9]+)$/.exec(ruta);
  if (!m) return null;
  const publicId = m[1];
  return { publicId, enIlustrativas: publicId.startsWith(`${CARPETA_ILUSTRATIVAS}/`) };
}

/** public_id de una URL de Cloudinary de la galería (para fotos anteriores sin public_id guardado). */
export function publicIdDeUrl(valor: string): string | null {
  return validarUrlGaleria(valor, process.env.CLOUDINARY_CLOUD_NAME)?.publicId ?? null;
}

/**
 * Borra una imagen en Cloudinary con la API firmada de destroy (sin SDK): POST a
 * https://api.cloudinary.com/v1_1/<nube>/image/destroy con public_id, timestamp, api_key y la firma de
 * public_id y timestamp. 'ok' si se borró; 'no_encontrada' si Cloudinary ya no la tenía. Cualquier otro resultado,
 * error HTTP o de red lanza. El secreto nunca sale ni se registra.
 */
export async function borrarImagenCloudinary(
  publicId: string,
  opciones: { fetchImpl?: typeof fetch; ahoraMs?: number } = {},
): Promise<'ok' | 'no_encontrada'> {
  const nube = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !apiKey || !secreto) {
    logger.error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET');
    throw new Error('Cloudinary no está configurado');
  }
  const params = { public_id: publicId, timestamp: String(Math.floor((opciones.ahoraMs ?? Date.now()) / 1000)) };
  const cuerpo = new URLSearchParams({ ...params, api_key: apiKey, signature: firmarParametrosCloudinary(params, secreto) });
  const res = await (opciones.fetchImpl ?? fetch)(`https://api.cloudinary.com/v1_1/${encodeURIComponent(nube)}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  });
  const datos = (await res.json().catch(() => ({}))) as { result?: unknown };
  if (res.ok && datos.result === 'ok') return 'ok';
  if (res.ok && datos.result === 'not found') return 'no_encontrada';
  throw new Error(`Cloudinary no borró la imagen (HTTP ${res.status})`);
}

/** Borrado y consulta en Cloudinary inyectables (las pruebas los sustituyen). */
@Injectable()
export class CloudinaryGaleria {
  borrar(publicId: string): Promise<'ok' | 'no_encontrada'> {
    return borrarImagenCloudinary(publicId);
  }

  recurso(publicId: string): Promise<RecursoCloudinary | null> {
    return consultarRecursoCloudinary(publicId);
  }
}
