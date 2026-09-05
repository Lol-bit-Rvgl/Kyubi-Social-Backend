/**
 * Script administrativo: concede el rol MODERATOR a una lista de correos.
 *
 * Uso:
 *   npx tsx scripts/grant-moderators.ts
 *
 * Hace una búsqueda case-insensitive por email y actualiza el enum
 * `UserRole` a MODERATOR. Los correos inexistentes se reportan con [SKIP].
 */
import { UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

const TARGET_EMAILS = [
  'ignaciogueglio79@gmail.com',
  'sylveochoa@gmail.com',
  'svalenciam51@gmail.com',
  'deprueba1030000@gmail.com',
  'ivanzeprin@gmail.com',
];

async function main() {
  for (const email of TARGET_EMAILS) {
    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, role: true },
    });

    if (!user) {
      console.log(`[SKIP] Correo ${normalized} no encontrado en BD`);
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.MODERATOR },
    });
    console.log(`[OK] Usuario ${normalized} actualizado a MODERATOR`);
  }
}

main()
  .catch((err) => {
    console.error('[grant-moderators] Error fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
