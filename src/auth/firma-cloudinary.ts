import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

const logger = new Logger('FirmaCloudinary');

/**
 * Firma de Cloudinary para una subida (https://cloudinary.com/documentation/authentication_signatures):
 * pares `nombre=valor` ordenados por nombre y unidos con `&`, el API secret pegado al final sin
 * separador, y SHA-1 en hexadecimal. `file`, `cloud_name`, `resource_type` y `api_key` no se firman.
 */
export function firmarParametrosCloudinary(params: Record<string, string>, secreto: string): string {
  const cadena = Object.keys(params)
    .sort()
    .map((nombre) => `${nombre}=${params[nombre]}`)
    .join('&');
  return createHash('sha1').update(cadena + secreto).digest('hex');
}

/**
 * Firma de corta duración (Cloudinary la acepta 1 hora desde `timestamp`) para que el usuario de
 * la sesión suba su foto de perfil a avatares/usuario_<id>. El cliente manda a `uploadUrl`:
 * file, api_key, signature y cada campo de `params` tal cual. El API secret nunca sale ni se registra.
 */
export function crearFirmaSubidaFoto(usuarioId: string, ahoraMs: number = Date.now()) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !secreto) {
    logger.error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET');
    throw new ServiceUnavailableException('La subida de fotos no está disponible por ahora.');
  }

  const params: Record<string, string> = {
    allowed_formats: 'jpg,png,webp',
    folder: 'avatares',
    invalidate: 'true',
    overwrite: 'true',
    public_id: `usuario_${usuarioId}`,
    timestamp: String(Math.floor(ahoraMs / 1000)),
    transformation: 'c_limit,w_1024,h_1024',
  };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    apiKey,
    params,
    signature: firmarParametrosCloudinary(params, secreto),
  };
}
