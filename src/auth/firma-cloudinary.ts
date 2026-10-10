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

/** Para qué se sube: decide la carpeta, los formatos y quién puede pedir la firma. */
export type UsoSubida = 'perfil' | 'galeria' | 'factura';

/** Usos que se piden en POST /api/subidas/firma (perfil va por POST /api/auth/me/foto/firma). */
export const USOS_SUBIDA_PERSONAL = ['galeria', 'factura'] as const;

/** Roles que pueden pedir cada uso de POST /api/subidas/firma. */
export const ROLES_POR_USO: Record<(typeof USOS_SUBIDA_PERSONAL)[number], readonly string[]> = {
  galeria: ['admin', 'estilista', 'empleado', 'becario'],
  factura: ['admin'],
};

/** Parámetros fijos de cada uso, sin timestamp. Nada de esto lo elige el cliente. */
function parametrosDeUso(uso: UsoSubida, usuarioId: string): Record<string, string> {
  switch (uso) {
    case 'perfil':
      return {
        // Los formatos que ya aceptaba el selector de la foto; la URL queda bajo /image/upload/ igual.
        allowed_formats: 'jpg,jpeg,png,webp,gif,avif,heic',
        folder: 'avatares',
        invalidate: 'true',
        overwrite: 'true',
        public_id: `usuario_${usuarioId}`,
        transformation: 'c_limit,w_1024,h_1024',
      };
    case 'galeria':
      // Sin public_id ni overwrite: Cloudinary pone un nombre aleatorio y nadie pisa archivos ajenos.
      // Los mismos formatos que aceptaban los botones de subida con el preset.
      return { allowed_formats: 'jpg,jpeg,png,webp,gif,avif,heic,heif', folder: 'galeria' };
    case 'factura':
      return { allowed_formats: 'pdf', folder: 'facturas' };
  }
}

/**
 * Firma de corta duración (Cloudinary la acepta 1 hora desde `timestamp`) para subir directo a
 * Cloudinary con la carpeta y los formatos fijos de `uso`. El cliente manda a `uploadUrl`:
 * file, api_key, signature y cada campo de `params` tal cual. El API secret nunca sale ni se registra.
 * El PDF de factura va por image/upload, como antes con el preset, para que su URL no cambie de forma.
 */
export function crearFirma(uso: UsoSubida, usuarioId: string, ahoraMs: number = Date.now()) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secreto = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !secreto) {
    logger.error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET');
    throw new ServiceUnavailableException(
      uso === 'perfil' ? 'La subida de fotos no está disponible por ahora.' : 'La subida de archivos no está disponible por ahora.',
    );
  }

  const params: Record<string, string> = {
    ...parametrosDeUso(uso, usuarioId),
    timestamp: String(Math.floor(ahoraMs / 1000)),
  };

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    apiKey,
    params,
    signature: firmarParametrosCloudinary(params, secreto),
  };
}

/** Foto de perfil propia: avatares/usuario_<id> (POST /api/auth/me/foto/firma). */
export function crearFirmaSubidaFoto(usuarioId: string, ahoraMs: number = Date.now()) {
  return crearFirma('perfil', usuarioId, ahoraMs);
}
