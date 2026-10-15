import { Transform } from 'class-transformer';

/**
 * Booleano estricto para las casillas de consentimiento. La ValidationPipe global (main.ts) usa
 * enableImplicitConversion, que convierte con Boolean(valor): "false", "no" o "0" llegaban como true y pasaban
 * @IsBoolean y @Equals(true). Este decorador conserva el valor crudo del cuerpo, así que solo el booleano real
 * (true o false del JSON) es válido y cualquier texto o número termina en 400 por @IsBoolean.
 * Va junto con @IsBoolean (y @Equals(true) en las casillas obligatorias).
 */
export function BooleanoEstricto(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj as Record<string, unknown> | undefined)?.[key]);
}
