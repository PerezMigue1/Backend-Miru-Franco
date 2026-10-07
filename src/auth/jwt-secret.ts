/**
 * JWT_SECRET firma y verifica las sesiones: sin él el servidor no debe arrancar (antes usaba un
 * respaldo fijo, conocido por cualquiera que lea el código). El mensaje nombra la variable, nunca su valor.
 */
export function jwtSecretObligatorio(valor: string | null | undefined): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new Error(
      'Falta la variable de entorno JWT_SECRET (o está vacía). Defínela en el entorno del servidor antes de arrancar.',
    );
  }
  return valor;
}
