import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  return ok([]);
});
