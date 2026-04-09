import * as crypto from 'crypto';

/**
 * Utilidades de seguridad
 */

/**
 * Sanitiza texto para prevenir XSS
 * Escapa caracteres HTML peligrosos que podrían ejecutarse como código
 * 
 * @param input - Texto a sanitizar
 * @returns Texto sanitizado
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/\u0000/g, '')      // Eliminar byte nulo (PostgreSQL no lo admite en TEXT/VARCHAR)
    .replace(/</g, '&lt;')      // < → &lt;
    .replace(/>/g, '&gt;')      // > → &gt;
    .replace(/"/g, '&quot;')    // " → &quot;
    .replace(/'/g, '&#x27;')    // ' → &#x27;
    .replace(/\//g, '&#x2F;')   // / → &#x2F;
    .trim();                     // Eliminar espacios al inicio y final
}

/**
 * Sanitiza email (solo normaliza, no escapa HTML)
 * Los emails no necesitan escape HTML porque no se renderizan como HTML
 * 
 * @param email - Email a normalizar
 * @returns Email normalizado
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.toLowerCase().trim();
}

/**
 * Normaliza teléfono para almacenamiento y búsqueda en BD.
 * Aplica: trim, quitar espacios internos, dejar solo dígitos y "+".
 * Así "+52 771 405 3712" y "+527714053712" se unifican en "+527714053712".
 *
 * @param phone - Teléfono a normalizar
 * @returns Teléfono normalizado (sin espacios, mismo formato para comparar)
 */
export function normalizePhone(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  const trimmed = phone.trim().replace(/\s/g, '');
  return trimmed.replace(/[^\d+]/g, '');
}

/**
 * Sanitiza teléfono (normaliza para guardar y buscar en BD con formato consistente)
 *
 * @param phone - Teléfono a sanitizar
 * @returns Teléfono sanitizado y normalizado (sin espacios, solo dígitos y +)
 */
export function sanitizePhone(phone: string): string {
  return normalizePhone(phone);
}

/**
 * Sanitiza código postal (solo números)
 * 
 * @param postalCode - Código postal a sanitizar
 * @returns Código postal sanitizado
 */
export function sanitizePostalCode(postalCode: string): string {
  if (!postalCode || typeof postalCode !== 'string') {
    return '';
  }
  // Solo permite números
  return postalCode.replace(/\D/g, '');
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
 * Evita log injection en una sola cadena: quita CRLF y caracteres de control; trunca.
 */
export function sanitizeForLogOutput(
  value: string | undefined | null,
  maxLen = 500,
): string {
  if (value == null || typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
    .slice(0, maxLen);
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

/**
 * Interfaz para datos de registro de usuario
 */
interface RegisterData {
  nombre?: string;
  email?: string;
  telefono?: string;
  password?: string;
  fechaNacimiento?: string;
  preguntaSeguridad?: {
    pregunta?: string;
    respuesta?: string;
  };
  perfilCapilar?: {
    tipoCabello?: 'liso' | 'ondulado' | 'rizado';
    colorNatural?: string;
    colorActual?: string;
    productosUsados?: string;
    tieneAlergias?: boolean;
    alergias?: string;
    tratamientosQuimicos?: boolean;
    tratamientos?: string;
  };
  aceptaAvisoPrivacidad?: boolean;
  recibePromociones?: boolean;
}

/**
 * Sanitiza un objeto completo de datos de usuario
 * Aplica sanitización a todos los campos de texto del objeto de registro
 * 
 * @param registerData - Datos de registro del usuario
 * @returns Datos sanitizados
 */
export function sanitizeRegisterData(registerData: RegisterData): RegisterData {
  if (!registerData || typeof registerData !== 'object') {
    return {};
  }

  const sanitized: RegisterData = {
    ...registerData,
    // Sanitizar campos principales
    nombre: registerData.nombre ? sanitizeInput(registerData.nombre) : '',
    email: registerData.email ? sanitizeEmail(registerData.email) : '',
    telefono: registerData.telefono ? sanitizePhone(registerData.telefono) : '',
    fechaNacimiento: registerData.fechaNacimiento, // Las fechas no necesitan sanitización
    // La contraseña NO se sanitiza aquí (se hashea en el backend)
    password: registerData.password,
    
    // Sanitizar pregunta de seguridad
    preguntaSeguridad: registerData.preguntaSeguridad ? {
      pregunta: registerData.preguntaSeguridad.pregunta 
        ? sanitizeInput(registerData.preguntaSeguridad.pregunta) 
        : '',
      respuesta: registerData.preguntaSeguridad.respuesta 
        ? sanitizeInput(registerData.preguntaSeguridad.respuesta) 
        : '',
    } : undefined,
    
    // Sanitizar perfil capilar
    perfilCapilar: registerData.perfilCapilar ? {
      tipoCabello: registerData.perfilCapilar.tipoCabello || 'liso', // Enum, no necesita sanitización
      tieneAlergias: registerData.perfilCapilar.tieneAlergias || false,
      alergias: registerData.perfilCapilar.alergias 
        ? sanitizeInput(registerData.perfilCapilar.alergias) 
        : undefined,
      tratamientosQuimicos: registerData.perfilCapilar.tratamientosQuimicos || false,
      tratamientos: registerData.perfilCapilar.tratamientos 
        ? sanitizeInput(registerData.perfilCapilar.tratamientos) 
        : undefined,
      colorNatural: registerData.perfilCapilar.colorNatural 
        ? sanitizeInput(registerData.perfilCapilar.colorNatural) 
        : undefined,
      colorActual: registerData.perfilCapilar.colorActual 
        ? sanitizeInput(registerData.perfilCapilar.colorActual) 
        : undefined,
      productosUsados: registerData.perfilCapilar.productosUsados 
        ? sanitizeInput(registerData.perfilCapilar.productosUsados) 
        : undefined,
    } : undefined,
    
    // Campos booleanos no necesitan sanitización
    aceptaAvisoPrivacidad: registerData.aceptaAvisoPrivacidad || false,
    recibePromociones: registerData.recibePromociones || false,
  };

  return sanitized;
}
