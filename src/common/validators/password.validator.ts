import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Validador personalizado para contraseñas seguras
 * Requisitos:
 * - Mínimo 8 caracteres
 * - Al menos una letra mayúscula
 * - Al menos una letra minúscula
 * - Al menos un número
 * - Al menos un carácter especial
 * - No emplear datos personales
 * - No seguir patrones simples
 * - Rechazar contraseñas triviales
 */

// Lista de contraseñas comunes y débiles
const COMMON_PASSWORDS = [
  'password', 'password123', 'password1', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'admin', 'admin123', 'letmein', 'welcome',
  'monkey', 'dragon', 'master', 'sunshine', 'princess', 'football', 'baseball',
  'iloveyou', 'trustno1', 'superman', 'batman', 'jesus', 'michael', 'jordan',
  'shadow', 'mustang', 'harley', 'freedom', 'whatever', 'hello', 'charlie',
  'aa123456', 'donald', 'password1', 'qwerty123', 'welcome123', 'monkey123',
];

// Secuencias comunes de teclado
const KEYBOARD_SEQUENCES = [
  'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
  '123456', '12345678', '123456789', '1234567890',
  'abcdef', 'abcdefgh', 'qwertyui', 'asdfghjk',
];

// Patrones simples (letras o números consecutivos)
const SIMPLE_PATTERNS = [
  /(.)\1{2,}/, // Mismo carácter repetido 3+ veces (aaa, 111)
  /(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i, // Letras consecutivas
  /(012|123|234|345|456|567|678|789|890)/, // Números consecutivos
];

/**
 * Verifica si la contraseña contiene datos personales
 */
function containsPersonalData(password: string, personalData: any): boolean {
  if (!personalData) return false;

  const lowerPassword = password.toLowerCase();
  const personalFields = [
    personalData.nombre,
    personalData.email?.split('@')[0], // Parte antes del @
    personalData.telefono,
    personalData.fechaNacimiento?.split('-')[0], // Año
    personalData.fechaNacimiento?.split('-')[2], // Día
    personalData.direccion?.calle,
    personalData.direccion?.colonia,
    personalData.preguntaSeguridad?.respuesta,
  ].filter(Boolean).map((v: string) => v?.toLowerCase());

  for (const field of personalFields) {
    if (field && field.length >= 3 && lowerPassword.includes(field)) {
      return true;
    }
  }

  return false;
}

/**
 * Verifica si la contraseña sigue un patrón simple
 */
function hasSimplePattern(password: string): boolean {
  const lowerPassword = password.toLowerCase();

  // Verificar secuencias de teclado
  for (const seq of KEYBOARD_SEQUENCES) {
    if (lowerPassword.includes(seq)) {
      return true;
    }
  }

  // Verificar patrones simples
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(password)) {
      return true;
    }
  }

  // Verificar si es solo números o solo letras
  if (/^\d+$/.test(password) || /^[a-z]+$/i.test(password)) {
    return true;
  }

  return false;
}

/**
 * Verifica si la contraseña es común/trivial
 */
function isCommonPassword(password: string): boolean {
  const lowerPassword = password.toLowerCase();
  return COMMON_PASSWORDS.some(common => lowerPassword === common || lowerPassword.includes(common));
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') {
            return false;
          }

          const password = value;

          // 1. Mínimo 8 caracteres
          if (password.length < 8) {
            return false;
          }

          // 2. Al menos una letra mayúscula
          if (!/[A-Z]/.test(password)) {
            return false;
          }

          // 3. Al menos una letra minúscula
          if (!/[a-z]/.test(password)) {
            return false;
          }

          // 4. Al menos un número
          if (!/[0-9]/.test(password)) {
            return false;
          }

          // 5. Al menos un carácter especial
          if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            return false;
          }

          // 6. No emplear datos personales
          // Nota: Esto requiere acceso al objeto completo, se manejará en el servicio
          // Por ahora, verificamos patrones básicos

          // 7. No seguir patrones simples
          if (hasSimplePattern(password)) {
            return false;
          }

          // 8. Rechazar contraseñas triviales
          if (isCommonPassword(password)) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return 'La contraseña debe tener al menos 8 caracteres, incluir mayúsculas, minúsculas, números y caracteres especiales. No puede contener datos personales, patrones simples o ser una contraseña común';
        },
      },
    });
  };
}

/**
 * Validador adicional para verificar datos personales
 * Debe usarse en el servicio después de obtener todos los datos del usuario
 */
export function validatePasswordAgainstPersonalData(
  password: string,
  personalData: {
    nombre?: string;
    email?: string;
    telefono?: string;
    fechaNacimiento?: string;
    direccion?: { calle?: string; colonia?: string };
    preguntaSeguridad?: { respuesta?: string };
  },
): { valid: boolean; reason?: string } {
  if (containsPersonalData(password, personalData)) {
    return {
      valid: false,
      reason: 'La contraseña no puede contener datos personales como tu nombre, email, teléfono, fecha de nacimiento o respuesta de seguridad',
    };
  }

  return { valid: true };
}


