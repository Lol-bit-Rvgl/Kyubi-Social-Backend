import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';

const schema = z.object({
  title: z.string().max(300).optional(),
  body: z.string().max(10000).optional(),
  contenido: z.string().max(10000).optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');
  const text = body.data.body ?? body.data.contenido ?? '';
  return ok({ text });
});
