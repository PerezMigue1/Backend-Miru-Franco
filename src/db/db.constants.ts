/** Tablas permitidas para import/export. No exponer tablas sensibles (tokens, sessions, logs). */
export const TABLAS_PERMITIDAS = [
  'productos',
  'usuarios',
  'servicios',
  'direcciones_usuario',
] as const;
export type TablaPermitida = (typeof TABLAS_PERMITIDAS)[number];
export type ImportMode = 'append' | 'missing_only' | 'upsert';

export const IMPORT_ALLOWED_TABLE_REGEX = /^[a-zA-Z0-9_.]+$/;
export const IMPORT_BLOCKED_TABLES = [
  '_prisma_migrations',
  'usuarios',
  'tokens_revocados',
  'codigos_oauth',
  'preguntas_disponibles',
  'metodos_pago_usuario',
] as const;
export const TRUNCATE_ALLOWED_TABLE_REGEX = /^[a-zA-Z0-9_.]+$/;
export const TRUNCATE_BLOCKED_TABLES = [
  '_prisma_migrations',
  'usuarios',
  'tokens_revocados',
  'codigos_oauth',
  'preguntas_disponibles',
] as const;

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ERROR_DETAILS = 50;

export const IMPORT_MODES_BY_TABLE: Record<
  TablaPermitida,
  {
    modosPermitidos: ImportMode[];
    conflictKeys: string[];
  }
> = {
  productos: { modosPermitidos: ['append'], conflictKeys: [] },
  usuarios: { modosPermitidos: ['append'], conflictKeys: [] },
  servicios: {
    modosPermitidos: ['append', 'missing_only', 'upsert'],
    conflictKeys: ['id'],
  },
  direcciones_usuario: {
    modosPermitidos: ['append', 'missing_only', 'upsert'],
    conflictKeys: ['id'],
  },
};

/**
 * CSV: un valor que empieza con =, +, - o @ se abre como fórmula en Excel o Sheets; se le antepone
 * una comilla simple. Un número (-150.00, +5) no es fórmula y queda igual.
 */
export function neutralizarFormulaCsv(valor: string): string {
  return /^[=+\-@]/.test(valor) && !/^[+-]?\d+(\.\d+)?$/.test(valor) ? `'${valor}` : valor;
}
