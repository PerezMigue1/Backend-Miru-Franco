import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Valida el encabezado `x-signature` de una notificación de Mercado Pago ("ts=...,v1=...").
 * La firma es HMAC-SHA256, con la clave secreta del webhook, de la plantilla
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (data.id en minúsculas si es alfanumérico).
 * No se valida la antigüedad de `ts`: los reintentos de Mercado Pago pueden traer el ts original,
 * y aceptar una notificación repetida es inofensivo porque el pago se consulta en su API y el
 * procesamiento es idempotente.
 */
export function validarFirmaMercadoPago(p: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
  secreto: string;
}): boolean {
  if (!p.secreto || !p.xSignature) return false;
  const partes = Object.fromEntries(
    p.xSignature.split(',').map((parte) => {
      const [clave, ...valor] = parte.trim().split('=');
      return [clave.trim(), valor.join('=').trim()];
    }),
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;

  const id = p.dataId ? (/^[a-z0-9]+$/i.test(p.dataId) ? p.dataId.toLowerCase() : p.dataId) : '';
  const manifest = `${id ? `id:${id};` : ''}${p.xRequestId ? `request-id:${p.xRequestId};` : ''}ts:${ts};`;
  const esperado = Buffer.from(createHmac('sha256', p.secreto).update(manifest).digest('hex'), 'hex');
  const recibido = Buffer.from(v1, 'hex');
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}
