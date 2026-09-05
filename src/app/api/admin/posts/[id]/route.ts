import { requireStaffRole } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { toIso } from '@/lib/serialize';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/posts/:id
 *
 * Detalle de una publicación para inspección de moderación. Devuelve todo
 * el post incluso si está ocultado preventivamente, junto a los datos del
 * autor y un extracto del contenido.
 */
export const GET = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: postId } = await context.params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      title: true,
      content: true,
      type: true,
      visibility: true,
      mediaUrls: true,
      coverImageUrl: true,
      audioUrl: true,
      tags: true,
      genres: true,
      warnViolence: true,
      warnAdult: true,
      warnDark: true,
      warnSpoiler: true,
      chapterMode: true,
      chapterNumber: true,
      characterName: true,
      characterAvatarUrl: true,
      allowComments: true,
      allowReactions: true,
      isPinned: true,
      pinnedAt: true,
      isHidden: true,
      hiddenReason: true,
      hiddenByUserId: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatarUrl: true,
          role: true,
          isSuspended: true,
          createdAt: true,
        },
      },
    },
  });

  if (!post) return fail('Publicación no encontrada', 404);

  // Determinar si el autor tiene un baneo activo.
  const hasActiveBan = await prisma.ban.count({
    where: { userId: post.authorId, revokedAt: null },
  }).then((count) => count > 0);

  return ok({
    data: {
      id: post.id,
      title: post.title,
      content: post.content,
      type: post.type,
      visibility: post.visibility,
      mediaUrls: post.mediaUrls,
      coverImageUrl: post.coverImageUrl,
      audioUrl: post.audioUrl,
      tags: post.tags,
      genres: post.genres,
      warnViolence: post.warnViolence,
      warnAdult: post.warnAdult,
      warnDark: post.warnDark,
      warnSpoiler: post.warnSpoiler,
      chapterMode: post.chapterMode,
      chapterNumber: post.chapterNumber,
      characterName: post.characterName,
      characterAvatarUrl: post.characterAvatarUrl,
      allowComments: post.allowComments,
      allowReactions: post.allowReactions,
      isPinned: post.isPinned,
      pinnedAt: toIso(post.pinnedAt),
      isHidden: post.isHidden,
      hiddenReason: post.hiddenReason,
      hiddenByUserId: post.hiddenByUserId,
      createdAt: toIso(post.createdAt),
      updatedAt: toIso(post.updatedAt),
      publishedAt: toIso(post.publishedAt),
      author: {
        id: post.author.id,
        username: post.author.username,
        displayName: post.author.displayName ?? post.author.username,
        email: post.author.email,
        avatarUrl: post.author.avatarUrl,
        role: post.author.role,
        isSuspended: post.author.isSuspended,
        isBanned: hasActiveBan,
        joinedAt: toIso(post.author.createdAt),
      },
    },
  });
});
