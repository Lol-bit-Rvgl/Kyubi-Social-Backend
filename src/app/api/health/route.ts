import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return ok({ status: 'ok', db: 'up', service: 'kyubi-social-backend', timestamp: new Date().toISOString() });
  } catch {
    return fail('Base de datos no disponible', 503);
  }
}
