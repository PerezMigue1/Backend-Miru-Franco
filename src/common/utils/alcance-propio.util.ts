/**
 * Modo portal de clienta (`?propios=true`): cualquier usuario, sea del rol que sea, actúa como clienta
 * sobre SUS datos (sus citas, sus pedidos) y lo ajeno responde 404. Sin el parámetro, cada endpoint se
 * comporta como siempre y lo que el personal ve de otras personas sale de sus claves de permisos_rol.
 */
export function esPropios(valor: unknown): boolean {
  return valor === true || valor === 'true' || valor === '1';
}
