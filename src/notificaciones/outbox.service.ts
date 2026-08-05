import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface CanalEncolado {
  canal: string;
  /** Decidido por el resolver (bloque 3) antes de llamar aquí: 'descartada' si
   *  el usuario tiene preferencia activo=false para (tipo, canal). Default
   *  'pendiente' (mismo default que la columna). */
  estado?: 'pendiente' | 'descartada';
  /** Sufijo opcional de la clave de idempotencia cuando un mismo (entidad, tipo,
   *  canal) puede repetirse para el mismo hecho (p. ej. reintentos con distinto
   *  motivo). No usado por los eventos mínimos del bloque 5. */
  discriminador?: string;
}

export interface DatoEncolar {
  usuarioId: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  metadata?: Prisma.InputJsonValue;
  prioridad?: string;
  entidadTipo: string;
  entidadId: string;
  urlAccion?: string;
  /** Envío diferido (p. ej. recordatorios): sin esto, cae al default de columna
   *  (`now()`) — mismo comportamiento que tenían todos los llamadores antes de
   *  este campo, no rompe nada existente. */
  programadoPara?: Date;
  canales: CanalEncolado[];
}

export interface EnvioEncolado {
  id: string;
  canal: string;
  estado: string;
  claveIdempotencia: string;
}

/**
 * Motor de persistencia del patrón Outbox: escribe el hecho de negocio
 * (`notificaciones`) y sus intentos de envío (`notificaciones_envios`) dentro
 * de la MISMA transacción que se le pasa — nunca abre una propia. No despacha
 * nada; eso es responsabilidad de DespachadorService (bloque 4), llamado por
 * el listener después de que esta transacción confirme.
 */
@Injectable()
export class OutboxService {
  async encolar(
    tx: Prisma.TransactionClient,
    dato: DatoEncolar,
  ): Promise<{ notificacionId: string; envios: EnvioEncolado[] }> {
    const notificacion = await tx.notificacion.create({
      data: {
        usuarioId: dato.usuarioId,
        tipo: dato.tipo,
        titulo: dato.titulo,
        mensaje: dato.mensaje,
        metadata: dato.metadata,
        prioridad: dato.prioridad,
        entidadTipo: dato.entidadTipo,
        entidadId: dato.entidadId,
        urlAccion: dato.urlAccion,
        programadaPara: dato.programadoPara,
      },
    });

    if (dato.canales.length === 0) {
      return { notificacionId: notificacion.id, envios: [] };
    }

    const filas = dato.canales.map((c) => ({
      notificacionId: notificacion.id,
      canal: c.canal,
      estado: c.estado ?? 'pendiente',
      ...(dato.programadoPara ? { programadoPara: dato.programadoPara } : {}),
      claveIdempotencia: this.construirClave(dato.entidadTipo, dato.entidadId, dato.tipo, c.canal, c.discriminador),
    }));

    // Idempotencia vía UNIQUE(clave_idempotencia) + skipDuplicates, NO try/catch
    // por fila: capturar un P2002 dentro de un $transaction interactivo de Prisma
    // deja la transacción de Postgres abortada (25P02) para el resto de
    // sentencias aunque el catch de JS "atrape" el error — createMany con
    // skipDuplicates es una única sentencia atómica (INSERT ... ON CONFLICT DO
    // NOTHING), no tiene ese riesgo.
    await tx.notificacionEnvio.createMany({ data: filas, skipDuplicates: true });

    const envios = await tx.notificacionEnvio.findMany({
      where: { claveIdempotencia: { in: filas.map((f) => f.claveIdempotencia) } },
      select: { id: true, canal: true, estado: true, claveIdempotencia: true },
    });

    return { notificacionId: notificacion.id, envios };
  }

  private construirClave(
    entidadTipo: string,
    entidadId: string,
    tipo: string,
    canal: string,
    discriminador?: string,
  ): string {
    const partes = [entidadTipo, entidadId, tipo, canal];
    if (discriminador) partes.push(discriminador);
    return partes.join(':');
  }
}
