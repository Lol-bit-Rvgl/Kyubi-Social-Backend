import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { muteInclude, banInclude, serializeMute, serializeBan } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

const now = () => new Date();
const activeFilter = () => ({
  revokedAt: null as Date | null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
});

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      isOnline: true,
      createdAt: true,
      _count: { select: { followers: true, following: true, posts: true } },
    },
  });
  if (!user) return fail('Usuario no encontrado', 404);

  const [activeMute, activeBan, recentMutes, recentBans] = await Promise.all([
    prisma.mute.findFirst({ where: { userId: id, ...activeFilter() }, orderBy: { createdAt: 'desc' }, include: muteInclude }),
    prisma.ban.findFirst({ where: { userId: id, ...activeFilter() }, orderBy: { createdAt: 'desc' }, include: banInclude }),
    prisma.mute.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 5, include: muteInclude }),
    prisma.ban.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 5, include: banInclude }),
  ]);

  return ok({
    ...serializeUser(user, { isMe: false }),
    activeMute: activeMute ? serializeMute(activeMute) : null,
    activeBan: activeBan ? serializeBan(activeBan) : null,
    muteHistory: recentMutes.map((m) => serializeMute(m)),
    banHistory: recentBans.map((b) => serializeBan(b)),
  });
});
