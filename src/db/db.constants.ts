/** Tablas permitidas para import/export. No exponer tablas sensibles (tokens, sessions, logs). */
export const TABLAS_PERMITIDAS = [
  'productos',
  'usuarios',
  'servicios',
  'direcciones_usuario',
] as const;
export type TablaPermitida = (typeof TABLAS_PERMITIDAS)[number];
export type ImportMode = 'append' | 'missing_only' | 'upsert';

export const IMPORT_ALLOWED_TABLE_REGEX = /^[a-z_][a-z0-9_]*$/;

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
