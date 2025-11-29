import * as crypto from 'crypto';

/**
 * Utilidades de seguridad
 */

/**
 * Sanitiza texto para prevenir XSS
 * Remueve caracteres HTML peligrosos
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Valida si un string contiene código SQL peligroso
 * Mejorado para reducir falsos positivos en emails y datos válidos
 */
export function containsSQLInjection(input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }

  // Si el input es muy corto, probablemente no es SQL injection
  if (input.length < 3) {
    return false;
  }

  // Validar formato de email básico antes de verificar SQL injection
  // Si parece un email válido, ser más permisivo
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const looksLikeEmail = emailPattern.test(input);
  
  // Si es un email válido, solo verificar patrones muy específicos y peligrosos
  if (looksLikeEmail) {
    // Para emails válidos, solo verificar intentos obvios de SQL injection
    // que no pueden ser parte de un email válido
    const emailSafePatterns = [
      // Comillas seguidas de comandos SQL (no válido en email)
      /['"][\s]*((union|select|insert|update|delete|drop|exec)[\s]+)/i,
      // UNION SELECT completo (no válido en email)
      /union[\s]+select[\s]+/i,
      // SELECT FROM completo (no válido en email)
      /select[\s]+[\w\*]+[\s]+from[\s]+/i,
      // Comentarios SQL (-- o /*) - no válidos en email
      /--[\s]*$/m,
      /\/\*.*\*\//,
      // OR/AND con 1=1 (no válido en email)
      /[\s]+(or|and)[\s]+['"]?1['"]?[\s]*=[\s]*['"]?1['"]?/i,
      // Caracteres peligrosos codificados seguidos de comandos SQL
      /(%27|%22|%3D|%3B).*(union|select|insert|update|delete|drop)/i,
    ];
    return emailSafePatterns.some((pattern) => pattern.test(input));
  }

  // Para campos que NO son emails, usar patrones más amplios
  const sqlPatterns = [
    // Comillas simples o dobles seguidas de comandos SQL
    /['"][\s]*((union|select|insert|update|delete|drop|exec|execute)[\s]+)/i,
    // UNION SELECT (debe tener ambos)
    /union[\s]+select[\s]+/i,
    // SELECT FROM (debe tener ambos)
    /select[\s]+[\w\*]+[\s]+from[\s]+/i,
    // INSERT INTO VALUES
    /insert[\s]+into[\s]+\w+[\s]+values/i,
    // DELETE FROM
    /delete[\s]+from[\s]+\w+/i,
    // DROP TABLE
    /drop[\s]+table[\s]+\w+/i,
    // UPDATE SET
    /update[\s]+\w+[\s]+set[\s]+/i,
    // EXEC/EXECUTE stored procedures
    /exec(ute)?[\s]+(xp_|sp_)/i,
    // Comentarios SQL (-- o /*)
    /--[\s]*$/m, // Comentario al final de línea
    /\/\*.*\*\//, // Comentario multilínea
    // OR 1=1 o variantes
    /[\s]+or[\s]+['"]?1['"]?[\s]*=[\s]*['"]?1['"]?/i,
    // AND 1=1 o variantes
    /[\s]+and[\s]+['"]?1['"]?[\s]*=[\s]*['"]?1['"]?/i,
    // Caracteres peligrosos codificados seguidos de comandos
    /(%27|%22|%3D|%3B).*(union|select|insert|update|delete|drop)/i,
  ];

  return sqlPatterns.some((pattern) => pattern.test(input));
}

/**
 * Genera un token seguro aleatorio
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Limpia datos sensibles de un objeto para logging
 */
export function sanitizeForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'otp',
    'codigoOTP',
    'resetPasswordToken',
    'respuestaSeguridad',
  ];

  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Lista de respuestas comunes que deben ser rechazadas
 */
const COMMON_ANSWERS = [
  '123',
  '1234',
  '12345',
  '123456',
  'password',
  'password123',
  'admin',
  'test',
  'prueba',
  'qwerty',
  'abc123',
  'welcome',
  'nombre',
  'apellido',
  'sin respuesta',
  'no sé',
  'no se',
  'no tengo',
  'ninguna',
  'ninguno',
];

/**
 * Valida si una respuesta es demasiado común o débil
 */
export function isCommonAnswer(answer: string): boolean {
  if (typeof answer !== 'string') {
    return false;
  }

  const normalized = answer.toLowerCase().trim();
  
  // Rechazar respuestas muy cortas
  if (normalized.length < 3) {
    return true;
  }
  
  // Rechazar respuestas comunes
  return COMMON_ANSWERS.some((common) => 
    normalized === common || 
    normalized.includes(common) ||
    common.includes(normalized)
  );
}
