import type { Prisma } from '@prisma/client';

/**
 * Al revocar una clienta su autorización de fotos del resultado (fotos_resultado), las fotos de la galería ligadas a
 * cualquiera de sus autorizaciones dejan de ser visibles. Se llama dentro de la transacción que inserta la revocación
 * (consentimientos y bandeja ARCO). La liga se conserva como evidencia; el panel la muestra como autorización revocada.
 */
export function ocultarFotosDeTitular(tx: Pick<Prisma.TransactionClient, 'galeriaFoto'>, usuarioId: string) {
  return tx.galeriaFoto.updateMany({
    where: { visible: true, consentimiento: { is: { usuarioId } } },
    data: { visible: false },
  });
}
