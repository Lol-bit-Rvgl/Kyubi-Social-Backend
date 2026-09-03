import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createRateLimiter } from '@/lib/rate-limit';
import { saveUpload, validateUpload } from '@/lib/upload';

const limiter = createRateLimiter({ windowMs: 60_000, max: 20 });

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  if (!limiter(`upload:${session.userId}`)) {
    return fail('Demasiadas subidas, inténtalo más tarde', 429);
  }
  const { kind } = await params;
  const form = await request.formData().catch(() => null);
  if (!form) return fail('No se recibieron archivos');
  const file = form.get('file');
  if (!(file instanceof File)) return fail('No se recibió ningún archivo');
  const invalid = validateUpload(file, kind);
  if (invalid) return fail(invalid, 413);
  const url = await saveUpload(file, kind);
  return ok({ url });
});
