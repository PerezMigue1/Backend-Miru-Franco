/** Tablas permitidas para import/export. No exponer tablas sensibles (tokens, sessions, logs). */
export const TABLAS_PERMITIDAS = ['productos', 'usuarios', 'servicios'] as const;
export type TablaPermitida = (typeof TABLAS_PERMITIDAS)[number];

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
