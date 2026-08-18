import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { saveUpload, uploadUrl } from '@/lib/upload';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ kind: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { kind } = await params;
  const form = await request.formData().catch(() => null);
  if (!form) return fail('No se recibieron archivos');
  const file = form.get('file');
  if (!(file instanceof File)) return fail('No se recibió ningún archivo');
  const name = await saveUpload(file);
  return ok({ url: uploadUrl(request, name) });
});
