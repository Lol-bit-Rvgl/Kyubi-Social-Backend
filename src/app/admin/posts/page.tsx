'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import {
  FileText,
  Pin,
  Eye,
  EyeOff,
  Trash2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Layers,
  Sparkles,
} from 'lucide-react';
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
      alert('No se pueden fijar más de 3 publicaciones. Desfija otra primero.');
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
      `¿Ocultar TODOS los posts de @${post.author.username}? (soft-delete)`
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
      alert(`${data.affectedCount} posts ocultos para @${post.author.username}`);
      loadPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 shadow-md">
              <FileText className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Publicaciones & Feed
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            {total} posts en el sistema · moderación y control de visibilidad
          </p>
        </div>
      </div>

      {/* Banner de fijados */}
      <div
        className={`liquid-glass rounded-2xl p-4 border flex items-center justify-between gap-4 transition-all ${
          pinnedCount >= 3
            ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
            : 'border-violet-500/30 bg-violet-950/20 text-violet-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
              pinnedCount >= 3
                ? 'bg-rose-500/20 border-rose-500/30 text-rose-400'
                : 'bg-violet-500/20 border-violet-500/30 text-violet-400'
            }`}
          >
            <Pin className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">
              Posts fijados en el Feed global
            </div>
            <p className="text-xs text-slate-400">
              {pinnedCount >= 3
                ? 'Límite máximo alcanzado (3/3). Desfija una publicación para fijar otra.'
                : `${pinnedCount} de 3 publicaciones fijadas activas.`}
            </p>
          </div>
        </div>
        <div className="font-mono text-sm font-bold px-3 py-1 rounded-xl bg-white/5 border border-white/10">
          {pinnedCount} / 3
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 p-1.5 liquid-glass rounded-2xl border border-white/10 w-fit">
        <button
          onClick={() => {
            setFilter('all');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
            filter === 'all'
              ? 'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white shadow-md shadow-violet-500/25 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Layers className="w-4 h-4" />
          Todos
        </button>
        <button
          onClick={() => {
            setFilter('pinned');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
            filter === 'pinned'
              ? 'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white shadow-md shadow-violet-500/25 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Pin className="w-4 h-4" />
          Fijados
        </button>
        <button
          onClick={() => {
            setFilter('hidden');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
            filter === 'hidden'
              ? 'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white shadow-md shadow-violet-500/25 font-semibold'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <EyeOff className="w-4 h-4" />
          Ocultos
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Lista de Posts */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 liquid-glass-subtle rounded-2xl border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="liquid-glass rounded-3xl p-12 text-center text-slate-500 border border-white/10">
          Sin publicaciones con el filtro actual
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`liquid-glass rounded-2xl p-5 border transition-all duration-300 shadow-lg shadow-black/20 ${
                post.isHidden
                  ? 'border-rose-500/30 opacity-75'
                  : post.isPinned
                    ? 'border-violet-500/40 shadow-violet-950/20'
                    : 'border-white/10 hover:border-violet-500/30'
              }`}
            >
              <div className="flex items-start gap-4 flex-wrap">
                {/* Autor */}
                <div className="flex items-center gap-3 min-w-[160px]">
                  {post.author.avatarUrl ? (
                    <img
                      src={post.author.avatarUrl}
                      alt={post.author.username}
                      className="w-10 h-10 rounded-2xl object-cover border border-white/15 shadow-sm"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white font-bold text-sm border border-white/15 shadow-sm">
                      {post.author.username[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {post.author.displayName || post.author.username}
                    </p>
                    <p className="text-xs text-slate-400 font-mono">@{post.author.username}</p>
                  </div>
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-[200px]">
                  {post.title && (
                    <p className="text-sm font-bold text-slate-100 mb-1 line-clamp-1 tracking-wide">
                      {post.title}
                    </p>
                  )}
                  <p className="text-sm text-slate-300 line-clamp-2 leading-relaxed">
                    {post.content?.slice(0, 200) || (
                      <span className="italic text-slate-500">Sin contenido textual</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 font-mono">
                    {new Date(post.createdAt).toLocaleString()}
                  </p>
                </div>

                {/* Badges + acciones */}
                <div className="flex flex-col gap-2.5 items-end">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {post.isPinned && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 font-semibold">
                        <Pin className="w-3 h-3" />
                        Fijado
                      </span>
                    )}
                    {post.isHidden && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-rose-950/40 text-rose-300 border border-rose-500/30 font-semibold">
                        <EyeOff className="w-3 h-3" />
                        Oculto
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTogglePin(post)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-violet-500/30 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 transition-all cursor-pointer"
                    >
                      <Pin className="w-3 h-3" />
                      {post.isPinned ? 'Desfijar' : 'Fijar'}
                    </button>
                    <button
                      onClick={() => handleToggleVisibility(post)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-all cursor-pointer"
                    >
                      {post.isHidden ? (
                        <>
                          <Eye className="w-3 h-3 text-amber-400" />
                          Mostrar
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3 h-3 text-slate-400" />
                          Ocultar
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handlePurgeAuthor(post)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-500/80 via-pink-500/80 to-purple-600/80 hover:from-rose-500 hover:to-purple-600 text-white font-medium shadow-md shadow-rose-500/20 transition-all cursor-pointer"
                      title="Ocultar todos los posts de este autor"
                    >
                      <Trash2 className="w-3 h-3" />
                      Purgar
                    </button>
                  </div>
                </div>
              </div>

              {post.isHidden && post.hiddenReason && (
                <div className="mt-3 text-xs text-rose-400/90 italic border-t border-white/10 pt-2.5 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>Motivo: {post.hiddenReason}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Paginación */}
      <div className="flex justify-center items-center gap-3 pt-4">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="liquid-glass px-4 py-2 rounded-xl text-sm border border-white/10 text-slate-300 hover:border-violet-500/40 disabled:opacity-30 disabled:hover:border-white/10 inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Anterior
        </button>
        <span className="px-4 py-2 text-sm text-slate-400 font-medium">Página {page}</span>
        <button
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
          className="liquid-glass px-4 py-2 rounded-xl text-sm border border-white/10 text-slate-300 hover:border-violet-500/40 disabled:opacity-30 disabled:hover:border-white/10 inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          Siguiente
          <ChevronRight className="w-4 h-4" />
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

