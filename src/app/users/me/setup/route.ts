import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { meSelect, serializeMe } from '@/lib/me';
import { prisma } from '@/lib/prisma';
import { saveUpload, uploadUrl } from '@/lib/upload';

export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const form = await request.formData().catch(() => null);
  if (!form) return fail('Datos inválidos');

  const data: Record<string, unknown> = {};
  const username = form.get('username');
  if (username && String(username).trim().length > 0) {
    const value = String(username).trim();
    const existing = await prisma.user.findUnique({ where: { username: value }, select: { id: true } });
    if (existing && existing.id !== session.userId) {
      return fail('Este nombre de usuario no está disponible', 409);
    }
    data.username = value;
  }
  const avatar = form.get('avatar');
  if (avatar && avatar instanceof File) {
    const name = await saveUpload(avatar);
    data.avatarUrl = uploadUrl(request, name);
  }
  if (Object.keys(data).length === 0) return fail('Sin cambios');

  const user = await prisma.user.update({
    where: { id: session.userId },
    data,
    select: meSelect,
  });
  return ok(serializeMe(user));
});
