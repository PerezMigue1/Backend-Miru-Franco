import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Nota: el valor de BD para "Becado" es 'becario' (ver ROLES_DB en roles.constants.ts).
const SEMILLAS_PERMISO_ROL = [
  { rol: 'admin',     claves: ['*'] },
  { rol: 'estilista', claves: ['citas:propias',   'servicios:lectura',  'clientes:lectura'] },
  { rol: 'empleado',  claves: ['ventas:escritura', 'citas:escritura',    'inventario:lectura'] },
  { rol: 'becario',   claves: ['citas:asignadas',  'servicios:lectura',  'clientes:lectura'] },
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
