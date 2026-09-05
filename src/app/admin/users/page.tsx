'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import { adminFetch } from '@/components/admin/api';
import SanctionModal from '@/components/admin/SanctionModal';

interface UserTitleDto {
  id: string;
  titleText: string;
  colorHex: string;
  displayOrder: number;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: string;
  isSuspended: boolean;
  suspendedUntil?: string | null;
  isProfileHidden: boolean;
  level: number;
  createdAt: string;
  titles: UserTitleDto[];
}

const TITLE_COLORS = ['#A594F9', '#5BC8AF', '#FFB300', '#EF4444', '#3B82F6', '#EC4899'];

function UsersContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const toast = useToast();

  const [sanctionTarget, setSanctionTarget] = useState<AdminUser | null>(null);
  const [titleTarget, setTitleTarget] = useState<AdminUser | null>(null);
  const [titleText, setTitleText] = useState('');
  const [titleColor, setTitleColor] = useState(TITLE_COLORS[0]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await adminFetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setUsers(data.data || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar usuarios');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleUnsanction = async (user: AdminUser) => {
    const reason = prompt(`Motivo para quitar sanciones a @${user.username}:`);
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await adminFetch(`/api/admin/users/${user.id}/unsanction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      toast(`Sanción removida de @${user.username}`);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleToggleProfileVisibility = async (user: AdminUser) => {
    const next = !user.isProfileHidden;
    const reason = prompt(
      `Motivo para ${next ? 'ocultar' : 'mostrar'} el perfil de @${user.username}:`
    );
    if (!reason || reason.trim().length < 3) return;
    try {
      const res = await adminFetch(`/api/admin/users/${user.id}/profile-visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: next, reason: reason.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      toast(`Perfil de @${user.username} ${next ? 'oculto' : 'visible'}`);
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleAssignTitle = async () => {
    if (!titleTarget || !titleText.trim()) return;
    try {
      const res = await adminFetch(`/api/admin/users/${titleTarget.id}/titles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titleText: titleText.trim(), colorHex: titleColor }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      toast(`Título "${titleText}" asignado a @${titleTarget.username}`);
      setTitleTarget(null);
      setTitleText('');
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">👥 Usuarios & Expedientes</h1>
        <p className="text-sm text-slate-400">
          {total} usuarios registrados · búsqueda por nombre o email
        </p>
      </div>

      {/* Buscar */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="🔍 Buscar por username, email o nombre..."
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
        />
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="p-12 text-center text-slate-500">
          No se encontraron usuarios para "{debouncedSearch}"
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 backdrop-blur hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start gap-4 flex-wrap">
                {/* Avatar */}
                <div className="relative">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center text-white font-bold">
                      {user.username[0]?.toUpperCase()}
                    </div>
                  )}
                  {user.isSuspended && (
                    <span
                      className="absolute -bottom-1 -right-1 text-xs"
                      title="Suspendido"
                    >
                      🔨
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white">
                      {user.displayName || user.username}
                    </span>
                    <span className="text-xs text-slate-500">@{user.username}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        user.role === 'OWNER'
                          ? 'bg-red-600/20 text-red-400'
                          : user.role === 'ADMIN'
                            ? 'bg-purple-600/20 text-purple-400'
                            : user.role === 'MODERATOR'
                              ? 'bg-teal-600/20 text-teal-400'
                              : 'bg-slate-700/50 text-slate-400'
                      }`}
                    >
                      {user.role}
                    </span>
                    {user.isSuspended && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-800">
                        Suspendido
                        {user.suspendedUntil &&
                          ` hasta ${new Date(user.suspendedUntil).toLocaleDateString()}`}
                      </span>
                    )}
                    {user.isProfileHidden && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-800">
                        👻 Perfil oculto
                      </span>
                    )}
                  </div>

                  {/* Titles */}
                  {user.titles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {user.titles.map((t) => (
                        <span
                          key={t.id}
                          className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{
                            backgroundColor: `${t.colorHex}22`,
                            color: t.colorHex,
                            border: `1px solid ${t.colorHex}55`,
                          }}
                        >
                          {t.titleText}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 mt-2">
                    Nivel {user.level} · Registrado{' '}
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setSanctionTarget(user)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-900/30 border border-red-800 text-red-400 hover:bg-red-900/50 transition-colors font-medium"
                  >
                    ⚖️ Sancionar
                  </button>
                  <button
                    onClick={() => handleUnsanction(user)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-900/30 border border-emerald-800 text-emerald-400 hover:bg-emerald-900/50 transition-colors"
                  >
                    ✓ Quitar sanción
                  </button>
                  <button
                    onClick={() => handleToggleProfileVisibility(user)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-800 text-amber-400 hover:bg-amber-900/50 transition-colors"
                  >
                    {user.isProfileHidden ? '👁️ Mostrar' : '👁️‍🗨️ Ocultar'}
                  </button>
                  <button
                    onClick={() => {
                      setTitleTarget(user);
                      setTitleText('');
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-purple-900/30 border border-purple-800 text-purple-300 hover:bg-purple-900/50 transition-colors"
                  >
                    🏷️ Título
                  </button>
                </div>
              </div>
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

      {/* Modals */}
      {sanctionTarget && (
        <SanctionModal
          userId={sanctionTarget.id}
          username={sanctionTarget.username}
          isOpen={!!sanctionTarget}
          onClose={() => setSanctionTarget(null)}
          onSuccess={loadUsers}
        />
      )}

      {/* Modal de título */}
      {titleTarget && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setTitleTarget(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-4">
              🏷️ Título para @{titleTarget.username}
            </h3>
            <input
              type="text"
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              placeholder="Ej: VIP, Moderador Junior, Ganador..."
              maxLength={80}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white mb-4 focus:outline-none focus:border-purple-500"
            />
            <div className="grid grid-cols-6 gap-2 mb-4">
              {TITLE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setTitleColor(color)}
                  className={`w-full h-9 rounded-lg border-2 transition-all ${
                    titleColor === color
                      ? 'border-white scale-110'
                      : 'border-transparent opacity-50'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTitleTarget(null)}
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssignTitle}
                disabled={!titleText.trim()}
                className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-bold text-white"
              >
                Asignar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function useToast() {
  return (msg: string) => {
    // Simple toast via alert (puede sustituirse con toast lib más adelante)
    const el = document.createElement('div');
    el.className =
      'fixed bottom-4 right-4 bg-emerald-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium animate-pulse';
    el.textContent = `✓ ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  };
}

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-400">Cargando usuarios...</div>
      }
    >
      <UsersContent />
    </Suspense>
  );
}
