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
 */
export function containsSQLInjection(input: string): boolean {
  if (typeof input !== 'string') {
    return false;
  }

  const sqlPatterns = [
    /(\%27)|(\')|(\-\-)|(\%23)|(#)/i, // SQL Meta characters
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i, // SQL Injection
    /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i, // SQL injection OR
    /((\%27)|(\'))union/i, // SQL injection UNION
    /exec(\s|\+)+(s|x)p\w+/i, // SQL injection EXEC/EXECUTE
    /union[^a-z]+select/i, // SQL injection UNION SELECT
    /select.*from/i, // SQL injection SELECT FROM
    /insert.*into.*values/i, // SQL injection INSERT
    /delete.*from/i, // SQL injection DELETE
    /drop.*table/i, // SQL injection DROP TABLE
    /update.*set/i, // SQL injection UPDATE
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
