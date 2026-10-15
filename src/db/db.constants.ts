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

/**
 * Tablas bloqueadas para TRUNCATE e importación: identidad, dinero (pagos, pedidos, ventas, caja,
 * devoluciones), citas, tokens y catálogos de seguridad, además de evidencia legal (consentimientos,
 * versiones_documentos_legales y solicitudes_arco, que son de solo inserción). También las sesiones y los
 * códigos de un solo uso (solicitudes_cambio_correo, sesiones_moviles: importar una fila con un hash conocido
 * permitiría suplantar a una clienta), historial_estados_pedido (fecha de entrega que cuenta el plazo del
 * art. 56), inventario_movimientos (el kardex) y permisos_rol. Todas existen en schema.prisma
 * (db.constants.spec.ts lo comprueba).
 */
export const TABLAS_BLOQUEADAS_OPERACIONES = [
  '_prisma_migrations',
  'usuarios',
  'tokens_revocados',
  'codigos_oauth',
  'preguntas_disponibles',
  'metodos_pago_usuario',
  'pagos',
  'pedidos',
  'pedido_items',
  'ventas_local',
  'ventas_local_items',
  'cortes_caja',
  'movimientos_caja',
  'devoluciones',
  'citas',
  'consentimientos',
  'versiones_documentos_legales',
  'solicitudes_arco',
  'solicitudes_cambio_correo',
  'sesiones_moviles',
  'historial_estados_pedido',
  'inventario_movimientos',
  'permisos_rol',
] as const;
export const IMPORT_BLOCKED_TABLES = TABLAS_BLOQUEADAS_OPERACIONES;
export const TRUNCATE_ALLOWED_TABLE_REGEX = /^[a-zA-Z0-9_.]+$/;
export const TRUNCATE_BLOCKED_TABLES = TABLAS_BLOQUEADAS_OPERACIONES;

/** Texto exacto que exige el backend para vaciar una tabla (la web ya lo pide en su modal). */
export function confirmacionTruncate(tabla: string): string {
  return `TRUNCATE ${tabla}`;
}

/** Texto exacto que exige el backend para importar sobre una tabla. */
export function confirmacionImportacion(tabla: string): string {
  return `IMPORTAR ${tabla}`;
}

/** Nombre de columna sin mayúsculas ni guiones bajos: así se compara snake_case con camelCase. */
function normalizarColumna(columna: string): string {
  return columna.toLowerCase().replace(/_/g, '');
}

/**
 * Columnas secretas: no salen NUNCA en ninguna exportación ni respaldo (CSV, JSON ni SQL):
 * password, respuesta_seguridad, cualquier columna de token (token, token_hash, resetPasswordToken,
 * codigos_oauth.token, dispositivos_push.token, tokens_revocados.token…) y los códigos de un solo uso
 * (codigoOTP, codigos_oauth.codigo, que se canjea por la sesión mientras está vigente, y
 * solicitudes_cambio_correo.codigo_hash). Tampoco se ofrecen para filtrar en explain.
 */
export function esColumnaSecreta(columna: string): boolean {
  const n = normalizarColumna(columna);
  return (
    n === 'password' ||
    n === 'respuestaseguridad' ||
    n === 'codigo' ||
    n === 'codigootp' ||
    n === 'codigohash' ||
    n === 'tokenhash' ||
    n.endsWith('token')
  );
}

/**
 * Datos de salud del perfil capilar: salen SOLO en el respaldo completo de admin
 * (DbService.respaldoCompleto); se excluyen de las exportaciones por tabla.
 */
const COLUMNAS_SALUD = new Set([
  'alergias',
  'tratamientos',
  'tratamientosquimicos',
  'tipocabello',
  'colornatural',
  'coloractual',
  'productosusados',
]);

export function esColumnaSalud(columna: string): boolean {
  return COLUMNAS_SALUD.has(normalizarColumna(columna));
}

/** Columna que no debe salir en una exportación por tabla: secreta o de salud. */
export function esColumnaExcluidaDeExportacion(columna: string): boolean {
  return esColumnaSecreta(columna) || esColumnaSalud(columna);
}

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
 * CSV: un valor que empieza con =, +, - o @, o con tabulador o retorno de carro (OWASP), se abre como
 * fórmula en Excel o Sheets; se le antepone una comilla simple. Un número (-150.00, +5) no es fórmula y
 * queda igual.
 */
export function neutralizarFormulaCsv(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) && !/^[+-]?\d+(\.\d+)?$/.test(valor) ? `'${valor}` : valor;
}
