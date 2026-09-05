'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import { adminFetch } from '@/components/admin/api';

interface PostAuthor {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

interface AdminPost {
  id: string;
  content?: string;
  title?: string | null;
  author: PostAuthor;
  authorId: string;
  isPinned: boolean;
  pinnedAt?: string | null;
  isHidden: boolean;
  hiddenReason?: string | null;
  hiddenByUserId?: string | null;
  featuredUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

function PostsContent() {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [total, setTotal] = useState(0);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'hidden' | 'pinned'>('all');
  const [page, setPage] = useState(1);

  const loadPosts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminFetch(
        `/api/admin/posts?filter=${filter}&page=${page}&limit=20`
      );
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setPosts(data.data || []);
      setTotal(data.total || 0);
      setPinnedCount(data.pinnedCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar posts');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleTogglePin = async (post: AdminPost) => {
    const next = !post.isPinned;
    if (next && pinnedCount >= 3) {
      alert('❌ No se pueden fijar más de 3 publicaciones. Desfija otra primero.');
      return;
    }
    const reason = prompt(
      `Motivo para ${next ? 'fijar' : 'desfijar'} este post (mínimo 3 caracteres):`
    );
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await adminFetch(`/api/admin/posts/${post.id}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: next, reason: reason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleToggleVisibility = async (post: AdminPost) => {
    const next = !post.isHidden;
    const reason = prompt(
      `Motivo para ${next ? 'ocultar' : 'mostrar'} este post:`
    );
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await adminFetch(`/api/admin/posts/${post.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: next, reason: reason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handlePurgeAuthor = async (post: AdminPost) => {
    const confirm1 = confirm(
      `⚠️ ¿Ocultar TODOS los posts de @${post.author.username}? (soft-delete)`
    );
    if (!confirm1) return;
    const reason = prompt('Motivo de la purga masiva (mínimo 3 caracteres):');
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await adminFetch('/api/admin/posts/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: post.authorId,
          reason: reason.trim(),
          hardDelete: false,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      const data = await res.json();
      alert(`✅ ${data.affectedCount} posts ocultos para @${post.author.username}`);
      loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">
            📝 Publicaciones & Feed
          </h1>
          <p className="text-sm text-slate-400">
            {total} posts en el sistema · filtros por estado
          </p>
        </div>
      </div>

      {/* Banner de fijados */}
      <div
        className={`mb-6 p-4 rounded-xl border-2 font-semibold text-sm ${
          pinnedCount >= 3
            ? 'bg-red-900/20 border-red-700 text-red-300'
            : 'bg-purple-900/20 border-purple-700 text-purple-300'
        }`}
      >
        📌 Posts fijados: <strong>{pinnedCount} / 3</strong>
        {pinnedCount >= 3 && (
          <span className="ml-2 text-xs">(Máximo alcanzado — desfija uno primero)</span>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-6">
        {(['all', 'hidden', 'pinned'] as const).map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'hidden' ? '🙈 Ocultos' : '📌 Fijados'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="p-12 text-center text-slate-500">
          Sin publicaciones con el filtro "{filter}"
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-slate-900/70 border rounded-xl p-4 backdrop-blur transition-colors ${
                post.isHidden
                  ? 'border-red-900/60 opacity-60'
                  : post.isPinned
                    ? 'border-purple-700'
                    : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start gap-3 flex-wrap">
                {/* Autor */}
                <div className="flex items-center gap-2 min-w-[140px]">
                  {post.author.avatarUrl ? (
                    <img
                      src={post.author.avatarUrl}
                      alt=""
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-700" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {post.author.displayName || post.author.username}
                    </p>
                    <p className="text-xs text-slate-500">@{post.author.username}</p>
                  </div>
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-[200px]">
                  {post.title && (
                    <p className="text-sm font-bold text-slate-200 mb-1 line-clamp-1">
                      {post.title}
                    </p>
                  )}
                  <p className="text-sm text-slate-400 line-clamp-2">
                    {post.content?.slice(0, 200) || 'Sin contenido'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    {new Date(post.createdAt).toLocaleString()}
                  </p>
                </div>

                {/* Badges + acciones */}
                <div className="flex flex-col gap-1.5 items-end">
                  <div className="flex gap-1 flex-wrap justify-end">
                    {post.isPinned && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-600/30 text-purple-300 border border-purple-700">
                        📌 Fijado
                      </span>
                    )}
                    {post.isHidden && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-800">
                        🙈 Oculto
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleTogglePin(post)}
                      className="text-xs px-2 py-1 rounded bg-purple-900/30 border border-purple-800 text-purple-300 hover:bg-purple-900/50"
                    >
                      {post.isPinned ? 'Desfijar' : '📌 Fijar'}
                    </button>
                    <button
                      onClick={() => handleToggleVisibility(post)}
                      className="text-xs px-2 py-1 rounded bg-amber-900/30 border border-amber-800 text-amber-300 hover:bg-amber-900/50"
                    >
                      {post.isHidden ? 'Mostrar' : 'Ocultar'}
                    </button>
                    <button
                      onClick={() => handlePurgeAuthor(post)}
                      className="text-xs px-2 py-1 rounded bg-red-900/30 border border-red-800 text-red-400 hover:bg-red-900/50"
                      title="Ocultar todos los posts de este autor"
                    >
                      🗑️ Purgar
                    </button>
                  </div>
                </div>
              </div>

              {post.isHidden && post.hiddenReason && (
                <p className="mt-2 text-xs text-red-400/80 italic border-t border-slate-800 pt-2">
                  Motivo: {post.hiddenReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      <div className="flex justify-center gap-2 mt-6">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="px-4 py-2 text-sm text-slate-400">Página {page}</span>
        <button
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
          className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default function AdminPostsPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-slate-400">Cargando posts...</div>}
    >
      <PostsContent />
    </Suspense>
  );
}
