/**
 * Catálogo de roles del sistema.
 * "Usuario" = no registrado (sin JWT). Una vez registrado, tiene uno de estos 5 roles.
 */

export const ROLES_DB = ['cliente', 'becario', 'empleado', 'estilista', 'admin'] as const;
export type RolDb = (typeof ROLES_DB)[number];

/** Rol por defecto al registrar (área de cliente) */
export const ROL_DEFAULT: RolDb = 'cliente';

export interface RolCatalogoItem {
  id: number;
  valor: RolDb; // valor en BD
  nombre: string;
  descripcion: string;
  permisos: string;
}

export const ROLES_CATALOGO: RolCatalogoItem[] = [
  {
    id: 1,
    valor: 'admin',
    nombre: 'Admin',
    descripcion: 'Acceso completo al sistema (incluye facturación, reportes y contabilidad)',
    permisos: 'Todos',
  },
  {
    id: 2,
    valor: 'estilista',
    nombre: 'Estilista',
    descripcion: 'Servicios y citas asignadas',
    permisos: 'Citas, Servicios, Clientes',
  },
  {
    id: 3,
    valor: 'empleado',
    nombre: 'Empleado',
    descripcion: 'Operaciones del día a día',
    permisos: 'Ventas, Citas, Inventario (consulta)',
  },
  {
    id: 4,
    valor: 'becario',
    nombre: 'Becado',
    descripcion: 'Prácticas con acceso limitado',
    permisos: 'Citas (asignadas), Servicios (consulta), Clientes (consulta)',
  },
  {
    id: 5,
    valor: 'cliente',
    nombre: 'Cliente',
    descripcion: 'Acceso a área de cliente',
    permisos: 'Mis Citas, Tienda online, Galería, Mi Perfil',
  },
];
