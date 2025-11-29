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
 * - Opcional: caracteres especiales (recomendado)
 */
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

          // Mínimo 8 caracteres
          if (value.length < 8) {
            return false;
          }

          // Al menos una letra mayúscula
          if (!/[A-Z]/.test(value)) {
            return false;
          }

          // Al menos una letra minúscula
          if (!/[a-z]/.test(value)) {
            return false;
          }

          // Al menos un número
          if (!/[0-9]/.test(value)) {
            return false;
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return 'La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número';
        },
      },
    });
  };
}


