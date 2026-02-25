/**
 * Asigna el rol 'admin' a un usuario por email.
 * Uso: npx ts-node -r tsconfig-paths/register scripts/set-admin.ts <email>
 * Ejemplo: npx ts-node -r tsconfig-paths/register scripts/set-admin.ts admin@ejemplo.com
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: npx ts-node -r tsconfig-paths/register scripts/set-admin.ts <email>');
    process.exit(1);
  }

  const usuario = await prisma.usuario.updateMany({
    where: { email: email.trim() },
    data: { rol: 'admin' },
  });

  if (usuario.count === 0) {
    console.error('No se encontró ningún usuario con ese email.');
    process.exit(1);
  }

  console.log('Rol "admin" asignado correctamente a:', email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
