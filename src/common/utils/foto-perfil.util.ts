/**
 * ¿Se puede guardar `valor` como foto de perfil (usuarios.foto) desde el cliente?
 * Se acepta:
 * - null o cadena vacía (quitar la foto);
 * - el mismo valor que el usuario ya tiene guardado (fotos de Google y valores anteriores);
 * - una imagen de la cuenta propia de Cloudinary: https://res.cloudinary.com/<cloudName>/image/upload/...
 * Sin `cloudName` configurado solo se aceptan los dos primeros casos.
 */
export function esFotoPerfilPermitida(
  valor: string | null,
  opciones: { cloudName?: string; fotoActual: string | null },
): boolean {
  if (valor === null) return true;
  const foto = valor.trim();
  if (foto === '') return true;
  if (opciones.fotoActual !== null && foto === opciones.fotoActual.trim()) return true;
  if (!opciones.cloudName) return false;

  let url: URL;
  try {
    url = new URL(foto);
  } catch {
    return false;
  }
  // `URL` ya resolvió los segmentos `..` de la ruta y pasó el host a minúsculas. Además se exige
  // que el texto ya venga en su forma canónica, porque se guarda tal como llega.
  // `URL` no decodifica %2F, %5C ni %2E sueltos: se rechazan para que nadie salte de carpeta después.
  // Una imagen subida no lleva query ni fragmento.
  const prefijo = `/${opciones.cloudName}/image/upload/`;
  return (
    url.href === foto &&
    url.protocol === 'https:' &&
    url.hostname === 'res.cloudinary.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    !foto.includes('?') &&
    !foto.includes('#') &&
    !/%(2f|5c|2e)/i.test(url.pathname) &&
    url.pathname.startsWith(prefijo) &&
    url.pathname.length > prefijo.length
  );
}
