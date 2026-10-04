import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Nota: el valor de BD para "Becado" es 'becario' (ver ROLES_DB en roles.constants.ts).
const SEMILLAS_PERMISO_ROL = [
  { rol: 'admin',     claves: ['*'] },
  // Citas y seguimientos: estilista y empleado escriben en cualquiera; el becario solo atiende sus citas
  // asignadas y lee seguimientos (igual que permisos_rol en producción).
  { rol: 'estilista', claves: ['citas:escritura',  'seguimientos:lectura', 'seguimientos:escritura', 'servicios:lectura', 'clientes:lectura', 'pedidos:entregar'] },
  { rol: 'empleado',  claves: ['ventas:escritura', 'citas:escritura', 'seguimientos:lectura', 'seguimientos:escritura', 'inventario:lectura', 'pedidos:entregar'] },
  { rol: 'becario',   claves: ['citas:asignadas',  'seguimientos:lectura', 'servicios:lectura', 'clientes:lectura'] },
  { rol: 'cliente',   claves: ['tienda:propia',    'citas:propia',       'perfil:propio'] },
];

async function main() {
  console.log('Iniciando seed de PermisoRol...');
  for (const semilla of SEMILLAS_PERMISO_ROL) {
    const resultado = await prisma.permisoRol.upsert({
      where:  { rol: semilla.rol },
      update: {},          // No sobreescribir si ya existe con claves personalizadas
      create: semilla,
    });
    console.log(`  ✔ ${resultado.rol} → [${resultado.claves.join(', ')}]`);
  }
  console.log('Seed completado.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
