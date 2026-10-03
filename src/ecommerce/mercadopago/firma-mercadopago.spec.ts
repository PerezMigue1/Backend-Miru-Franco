import { createHmac } from 'node:crypto';
import { validarFirmaMercadoPago } from './firma-mercadopago';

const SECRETO = 'secreto-de-prueba';
/** Firma calculada a mano con la plantilla documentada por Mercado Pago. */
const firmar = (manifest: string, secreto = SECRETO) => createHmac('sha256', secreto).update(manifest).digest('hex');

describe('Firma de las notificaciones de Mercado Pago (x-signature)', () => {
  const ts = '1704908010';
  const v1 = firmar(`id:123456;request-id:req-abc;ts:${ts};`);

  it('acepta la firma calculada con id, request-id y ts', () => {
    expect(validarFirmaMercadoPago({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-abc', dataId: '123456', secreto: SECRETO })).toBe(true);
  });

  it('tolera espacios entre las partes del encabezado', () => {
    expect(validarFirmaMercadoPago({ xSignature: ` ts=${ts} , v1=${v1} `, xRequestId: 'req-abc', dataId: '123456', secreto: SECRETO })).toBe(true);
  });

  it('un data.id alfanumérico se firma en minúsculas', () => {
    const firma = firmar(`id:abc123;request-id:req-abc;ts:${ts};`);
    expect(validarFirmaMercadoPago({ xSignature: `ts=${ts},v1=${firma}`, xRequestId: 'req-abc', dataId: 'ABC123', secreto: SECRETO })).toBe(true);
  });

  it.each([
    ['otro secreto', { secreto: 'otro' }],
    ['otro data.id', { dataId: '999' }],
    ['otro x-request-id', { xRequestId: 'req-zzz' }],
  ])('rechaza la firma con %s', (_caso, cambio) => {
    expect(
      validarFirmaMercadoPago({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-abc', dataId: '123456', secreto: SECRETO, ...cambio }),
    ).toBe(false);
  });

  it.each([
    ['sin encabezado', undefined],
    ['sin v1', `ts=${ts}`],
    ['sin ts', `v1=${v1}`],
    ['v1 que no es hexadecimal', `ts=${ts},v1=zzzz`],
    ['v1 de otro largo', `ts=${ts},v1=${v1.slice(0, 10)}`],
  ])('rechaza un encabezado mal formado: %s', (_caso, xSignature) => {
    expect(validarFirmaMercadoPago({ xSignature, xRequestId: 'req-abc', dataId: '123456', secreto: SECRETO })).toBe(false);
  });

  it('sin secreto configurado nunca acepta', () => {
    expect(validarFirmaMercadoPago({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-abc', dataId: '123456', secreto: '' })).toBe(false);
  });
});
