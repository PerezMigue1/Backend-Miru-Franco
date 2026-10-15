import { randomBytes } from 'node:crypto';

/**
 * Subida segura de imágenes (galería y formularios): el servidor firma UNA subida con un public_id que él genera
 * dentro de la carpeta del uso y solo registra imágenes que salieron de una firma propia, vigente y sin usar.
 * Nunca se acepta una URL de imagen escrita a mano.
 */
export const USOS_IMAGEN = ['galeria', 'servicios', 'productos', 'equipo', 'promociones', 'sitio', 'usuarios'] as const;
export type UsoImagen = (typeof USOS_IMAGEN)[number];

/** Permiso que pide cada uso para firmar (admin pasa con '*'). */
export const PERMISO_POR_USO: Record<UsoImagen, string> = {
  galeria: 'galeria:gestionar',
  servicios: 'servicios:escritura',
  productos: 'servicios:escritura',
  equipo: 'configuracion:editar',
  promociones: 'configuracion:editar',
  sitio: 'configuracion:editar',
  /** Foto de otra persona que sube el admin en Usuarios y roles o Clientes (PUT /api/usuarios/:id es solo admin). */
  usuarios: 'usuarios:gestionar',
};

/** Usos donde se puede marcar la imagen como ilustrativa (va a <carpeta>/ilustrativas/ y nunca pasa por trabajo real). */
export const USOS_CON_ILUSTRATIVA: readonly UsoImagen[] = ['galeria', 'servicios', 'sitio'];

/** Vigencia de la firma: Cloudinary la acepta una hora desde su timestamp. */
export const VIGENCIA_FIRMA_MS = 60 * 60 * 1000;
/** Las firmas vencidas y sin usar se limpian después de este tiempo. */
export const LIMPIAR_FIRMAS_DESPUES_MS = 24 * 60 * 60 * 1000;

export const esUsoImagen = (valor: unknown): valor is UsoImagen => typeof valor === 'string' && (USOS_IMAGEN as readonly string[]).includes(valor);

/** public_id que genera el servidor para el uso: <carpeta>/panel_<32 hex> o <carpeta>/ilustrativas/panel_<32 hex>. */
export function patronPublicId(uso: UsoImagen): RegExp {
  return new RegExp(`^${uso}/(ilustrativas/)?panel_[0-9a-f]{32}$`);
}

export const esPublicIdDe = (uso: UsoImagen, valor: unknown): valor is string => typeof valor === 'string' && patronPublicId(uso).test(valor);

/** public_id nuevo e irrepetible dentro de la carpeta del uso. */
export function nuevoPublicId(uso: UsoImagen, ilustrativa: boolean): string {
  return `${uso}/${ilustrativa ? 'ilustrativas/' : ''}panel_${randomBytes(16).toString('hex')}`;
}

export const MENSAJE_URL_A_MANO =
  'No se aceptan URLs de imagen escritas a mano. Usa el botón "Subir foto" para subir la imagen desde tu dispositivo.';
export const MENSAJE_SUBIDA_NO_PROPIA = 'Esta imagen no salió de una subida del panel. Súbela con el botón "Subir foto" e inténtalo de nuevo.';
export const MENSAJE_SUBIDA_VENCIDA = 'La subida venció (dura una hora). Vuelve a subir la imagen.';
export const MENSAJE_SUBIDA_USADA = 'Esta subida ya se registró. Para otra imagen, súbela de nuevo.';
export const MENSAJE_IMAGEN_NO_ESTA = 'La imagen no está en Cloudinary. Vuelve a subirla.';
export const MENSAJE_CLOUDINARY_SIN_RESPUESTA = 'No pudimos comprobar la imagen en Cloudinary. Intenta de nuevo en unos minutos.';
