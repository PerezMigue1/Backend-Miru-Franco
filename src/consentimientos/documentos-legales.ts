import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { diaEnMexico } from '../common/utils/zona-mexico';
import { ipDelCliente, PeticionConIp } from '../common/utils/ip-cliente.util';
import { DOCUMENTOS_OBLIGATORIOS, METODO_CASILLA, SlugDocumento, TipoConsentimiento } from './consentimientos.constants';

/**
 * Lo que comparten el módulo de consentimientos, el registro con correo y el registro con Google: validar el
 * documento aceptado contra versiones_documentos_legales, encontrar la versión vigente y armar las filas.
 * Reciben el cliente de Prisma o la transacción (tx) para poder ir dentro de la misma transacción.
 */
export interface DocumentoAceptado {
  slug: string;
  version: string;
  hash: string;
}

export interface ContextoPeticion {
  ip: string | null;
  userAgent: string | null;
}

interface ClienteVersiones {
  versionDocumentoLegal: { findFirst: (args: any) => Promise<any> };
}

interface ClienteHistorialVersiones {
  versionDocumentoLegal: { findMany: (args: any) => Promise<any[]> };
}

/** 400 si (slug, versión, hash) no está publicado en versiones_documentos_legales. */
export async function validarDocumento(cliente: ClienteVersiones, doc: DocumentoAceptado): Promise<void> {
  const fila = await cliente.versionDocumentoLegal.findFirst({
    where: { slug: doc.slug, version: doc.version, hashTexto: doc.hash },
    select: { id: true },
  });
  if (!fila) {
    throw new BadRequestException(
      `La versión ${doc.version} del documento "${doc.slug}" no está publicada o su hash no coincide. Recarga la página y vuelve a intentarlo.`,
    );
  }
}

/** Versión vigente de un documento: la más reciente con vigente_desde <= hoy (día de México). null si no hay. */
export async function versionVigente(
  cliente: ClienteVersiones,
  slug: SlugDocumento,
  ahora: Date = new Date(),
): Promise<{ slug: string; version: string; hashTexto: string; vigenteDesde: Date } | null> {
  const hoy = new Date(`${diaEnMexico(ahora)}T00:00:00.000Z`);
  return cliente.versionDocumentoLegal.findFirst({
    where: { slug, vigenteDesde: { lte: hoy } },
    orderBy: [{ vigenteDesde: 'desc' }, { id: 'desc' }],
    select: { slug: true, version: true, hashTexto: true, vigenteDesde: true },
  });
}

/**
 * true si la versión que aceptó la persona (versión y hash publicados) sigue valiendo para la vigente: todas las
 * versiones que entraron en vigor después de la aceptada son correcciones menores (contenidos_documentos_legales
 * con requiere_aceptacion = false; Admin > Documentos legales). Una versión sin texto en la base (anterior al editor)
 * cuenta como cambio importante. Si la aceptada no está publicada, false.
 */
export async function aceptacionCubreVigente(
  cliente: ClienteHistorialVersiones,
  slug: SlugDocumento,
  aceptada: { version: string | null; hash: string | null },
  ahora: Date = new Date(),
): Promise<boolean> {
  if (!aceptada.version || !aceptada.hash) return false;
  const hoy = new Date(`${diaEnMexico(ahora)}T00:00:00.000Z`);
  const versiones = await cliente.versionDocumentoLegal.findMany({
    where: { slug, vigenteDesde: { lte: hoy } },
    orderBy: [{ vigenteDesde: 'asc' }, { id: 'asc' }],
    select: { version: true, hashTexto: true, contenido: { select: { requiereAceptacion: true } } },
  });
  const i = versiones.findIndex((v) => v.version === aceptada.version && v.hashTexto === aceptada.hash);
  if (i < 0) return false;
  return versiones.slice(i + 1).every((v) => v.contenido?.requiereAceptacion === false);
}

/**
 * Versión vigente de un documento como documento aceptado (slug, versión y hash). Sin ninguna publicada es un
 * error del servidor (falta sembrarla): no se registra un consentimiento ligado a ese documento sin él.
 */
export async function documentoVigente(cliente: ClienteVersiones, slug: SlugDocumento, ahora: Date = new Date()): Promise<DocumentoAceptado> {
  const vigente = await versionVigente(cliente, slug, ahora);
  if (!vigente) throw new InternalServerErrorException(`No hay una versión publicada del documento "${slug}".`);
  return { slug, version: vigente.version, hash: vigente.hashTexto };
}

/**
 * Documentos obligatorios (términos y aviso de privacidad) que se aceptan al crear la cuenta: los que mandó el
 * formulario (validados) o, si no los mandó, la versión vigente en ese momento, que es la que enlaza el formulario.
 */
export async function documentosDeRegistro(
  cliente: ClienteVersiones,
  documentos: DocumentoAceptado[] | undefined,
  ahora: Date = new Date(),
): Promise<Record<'terminos' | 'aviso-privacidad', DocumentoAceptado>> {
  for (const doc of documentos ?? []) await validarDocumento(cliente, doc);
  const resultado = {} as Record<'terminos' | 'aviso-privacidad', DocumentoAceptado>;
  for (const { slug } of DOCUMENTOS_OBLIGATORIOS) {
    const enviado = documentos?.find((d) => d.slug === slug);
    if (enviado) {
      resultado[slug as 'terminos' | 'aviso-privacidad'] = { slug, version: enviado.version, hash: enviado.hash };
      continue;
    }
    resultado[slug as 'terminos' | 'aviso-privacidad'] = await documentoVigente(cliente, slug, ahora);
  }
  return resultado;
}

/**
 * Fila de consentimiento (creado_en lo pone la base). `registradoPorId`: quién la capturó cuando no fue la
 * titular (el admin en el alta o en la ficha, el personal al revocar promociones); sin él la columna queda NULL.
 */
export function filaConsentimiento(datos: {
  usuarioId: string | null;
  visitanteId?: string | null;
  tipo: TipoConsentimiento;
  accion: 'aceptado' | 'revocado';
  documento: DocumentoAceptado | null;
  formulario: string;
  rutaOrigen: string | null;
  contexto: ContextoPeticion;
  registradoPorId?: string | null;
}) {
  return {
    usuarioId: datos.usuarioId,
    visitanteId: datos.visitanteId ?? null,
    tipo: datos.tipo,
    documentoSlug: datos.documento?.slug ?? null,
    documentoVersion: datos.documento?.version ?? null,
    documentoHash: datos.documento?.hash ?? null,
    accion: datos.accion,
    ip: datos.contexto.ip,
    userAgent: datos.contexto.userAgent,
    formulario: datos.formulario,
    rutaOrigen: datos.rutaOrigen,
    metodo: METODO_CASILLA,
    ...(datos.registradoPorId ? { registradoPorId: datos.registradoPorId } : {}),
  };
}

/**
 * Consentimientos del alta de una cuenta: términos y aviso de privacidad siempre; promociones solo si la persona
 * las pidió; datos_salud solo si capturó datos de salud con su consentimiento expreso. Las finalidades
 * secundarias (promociones) y el tratamiento de datos de salud se describen en el aviso de privacidad: esas
 * filas guardan la versión del aviso que se aceptó.
 */
export function filasConsentimientoAlta(datos: {
  usuarioId: string;
  documentos: Record<'terminos' | 'aviso-privacidad', DocumentoAceptado>;
  recibePromociones: boolean;
  datosSalud: boolean;
  formulario: string;
  rutaOrigen: string | null;
  contexto: ContextoPeticion;
  /** Alta hecha por el admin: su id en cada fila. */
  registradoPorId?: string | null;
  /** La app móvil actual no manda aceptaTerminos: sin fila de términos, queda pendiente (compatibilidad temporal). */
  sinTerminos?: boolean;
}) {
  const comun = {
    usuarioId: datos.usuarioId,
    accion: 'aceptado' as const,
    formulario: datos.formulario,
    rutaOrigen: datos.rutaOrigen,
    contexto: datos.contexto,
    registradoPorId: datos.registradoPorId,
  };
  const aviso = datos.documentos['aviso-privacidad'];
  return [
    ...(datos.sinTerminos ? [] : [filaConsentimiento({ ...comun, tipo: 'terminos', documento: datos.documentos.terminos })]),
    filaConsentimiento({ ...comun, tipo: 'aviso_privacidad', documento: aviso }),
    ...(datos.recibePromociones ? [filaConsentimiento({ ...comun, tipo: 'promociones', documento: aviso })] : []),
    ...(datos.datosSalud ? [filaConsentimiento({ ...comun, tipo: 'datos_salud', documento: aviso })] : []),
  ];
}

/**
 * IP de evidencia: la misma que usa el límite de peticiones (ipDelCliente, common/utils/ip-cliente.util.ts):
 * req.ip de Express, luego la dirección del socket y, solo sin ninguna de las dos, x-forwarded-for.
 */
export function ipDeRequest(req: PeticionConIp | undefined): string | null {
  return ipDelCliente(req);
}

export function userAgentDeRequest(req: { headers?: Record<string, unknown> } | undefined): string | null {
  const valor = req?.headers?.['user-agent'];
  return typeof valor === 'string' && valor ? valor.slice(0, 500) : null;
}

export function contextoDeRequest(req: PeticionConIp | undefined): ContextoPeticion {
  return { ip: ipDeRequest(req), userAgent: userAgentDeRequest(req) };
}

/** El id es BigInt y Express no lo serializa: va como texto. */
export function serializarConsentimiento<T extends { id: bigint | number | string }>(fila: T): Omit<T, 'id'> & { id: string } {
  return { ...fila, id: fila.id.toString() };
}
