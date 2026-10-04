import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** Quien hace la petición: id, rol y claves de permisos_rol (las adjunta PermisosGuard). */
export interface Solicitante {
  id: string;
  rol?: string;
  claves?: string[];
}

const tiene = (claves: string[] | undefined, clave: string) => !!claves && (claves.includes('*') || claves.includes(clave));

/** Escribe sobre cualquier cita: admin ('*'), estilista y empleado ('citas:escritura'). */
export function puedeEscribirCualquierCita(s: Solicitante): boolean {
  return tiene(s.claves, 'citas:escritura');
}

/**
 * Matriz de escritura sobre UNA cita (cancelar, reprogramar, editar, check-in/out, materiales):
 * - con 'citas:escritura' (admin, estilista, empleado): cualquier cita;
 * - clienta: solo las suyas; con una ajena responde 404 para no revelar que existe;
 * - especialista sin escritura (becario, 'citas:asignadas'): solo las que tiene asignadas.
 * El guard ya decidió qué rol entra a cada endpoint; esto limita a qué cita.
 */
export function assertPuedeEscribirCita(cita: { clienteId: string | null; especialistaId: string }, s: Solicitante, propios = false): void {
  // Portal de clienta (cualquier rol): solo su propia cita; la ajena responde 404 aunque tenga escritura.
  if (propios) {
    if (cita.clienteId === s.id) return;
    throw new NotFoundException('Cita no encontrada');
  }
  if (puedeEscribirCualquierCita(s)) return;
  if (s.rol === 'cliente') {
    if (cita.clienteId === s.id) return;
    throw new NotFoundException('Cita no encontrada');
  }
  if ((tiene(s.claves, 'citas:asignadas') || tiene(s.claves, 'citas:propias')) && cita.especialistaId === s.id) return;
  throw new ForbiddenException('Solo puedes modificar las citas que tienes asignadas');
}

/** Solicitante a partir del request que dejó PermisosGuard. */
export function solicitanteDe(req: { user: { id: string }; rolUsuario?: string; permisosUsuario?: string[] }): Solicitante {
  return { id: req.user.id, rol: req.rolUsuario, claves: req.permisosUsuario ?? [] };
}
