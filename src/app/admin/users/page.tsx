'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import {
  Users,
  Search,
  Gavel,
  ShieldCheck,
  Eye,
  EyeOff,
  Tag,
  ChevronLeft,
  ChevronRight,
  Ban,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 shadow-md">
              <Users className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Usuarios & Expedientes
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            {total} usuarios registrados · búsqueda y gestión de expedientes
          </p>
        </div>
      </div>

      {/* Barra de Búsqueda */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por username, email o nombre..."
          className="w-full pl-11 pr-4 py-3 liquid-glass rounded-2xl border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all shadow-inner"
        />
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Lista de Usuarios */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 liquid-glass-subtle rounded-2xl border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="liquid-glass rounded-3xl p-12 text-center text-slate-500 border border-white/10">
          No se encontraron usuarios para "{debouncedSearch}"
        </div>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="liquid-glass rounded-2xl p-5 border border-white/10 hover:border-violet-500/30 transition-all duration-300 shadow-lg shadow-black/20 group"
            >
              <div className="flex items-start gap-4 flex-wrap">
                {/* Avatar */}
                <div className="relative">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-12 h-12 rounded-2xl object-cover border border-white/15 shadow-md"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white font-bold text-lg border border-white/15 shadow-md">
                      {user.username[0]?.toUpperCase()}
                    </div>
                  )}
                  {user.isSuspended && (
                    <span
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-rose-600 border border-slate-950 flex items-center justify-center text-white shadow"
                      title="Usuario Suspendido"
                    >
                      <Ban className="w-3 h-3" />
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-bold text-white tracking-wide">
                      {user.displayName || user.username}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">@{user.username}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                        user.role === 'OWNER'
                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          : user.role === 'ADMIN'
                            ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                            : user.role === 'MODERATOR'
                              ? 'bg-teal-500/15 text-teal-300 border-teal-500/30'
                              : 'bg-slate-800/40 text-slate-400 border-white/10'
                      }`}
                    >
                      {user.role}
                    </span>
                    {user.isSuspended && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-rose-950/40 text-rose-300 border border-rose-500/30 font-medium">
                        <Ban className="w-3 h-3" />
                        Suspendido
                        {user.suspendedUntil &&
                          ` hasta ${new Date(user.suspendedUntil).toLocaleDateString()}`}
                      </span>
                    )}
                    {user.isProfileHidden && (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-amber-950/40 text-amber-300 border border-amber-500/30 font-medium">
                        <EyeOff className="w-3 h-3" />
                        Perfil oculto
                      </span>
                    )}
                  </div>

                  {/* Titles */}
                  {user.titles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 my-2">
                      {user.titles.map((t) => (
                        <span
                          key={t.id}
                          className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: `${t.colorHex}20`,
                            color: t.colorHex,
                            border: `1px solid ${t.colorHex}50`,
                          }}
                        >
                          {t.titleText}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 mt-1">
                    Nivel {user.level} · Registrado{' '}
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap items-center">
                  <button
                    onClick={() => setSanctionTarget(user)}
                    className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl bg-gradient-to-r from-rose-500/80 via-pink-500/80 to-purple-600/80 hover:from-rose-500 hover:to-purple-600 text-white font-medium shadow-md shadow-rose-500/20 transition-all cursor-pointer"
                  >
                    <Gavel className="w-3.5 h-3.5" />
                    Sancionar
                  </button>
                  <button
                    onClick={() => handleUnsanction(user)}
                    className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500/80 via-teal-500/80 to-cyan-500/80 hover:from-emerald-500 hover:to-cyan-500 text-white font-medium shadow-md shadow-teal-500/20 transition-all cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Quitar sanción
                  </button>
                  <button
                    onClick={() => handleToggleProfileVisibility(user)}
                    className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 transition-all cursor-pointer"
                  >
                    {user.isProfileHidden ? (
                      <>
                        <Eye className="w-3.5 h-3.5 text-amber-400" />
                        Mostrar
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                        Ocultar
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setTitleTarget(user);
                      setTitleText('');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 transition-all cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    Título
                  </button>
                </div>
              </div>
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
          className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200"
          onClick={() => setTitleTarget(null)}
        >
          <div
            className="liquid-glass border border-white/15 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2 text-white font-bold">
                <Tag className="w-5 h-5 text-violet-400" />
                <h3>Título para @{titleTarget.username}</h3>
              </div>
              <button
                onClick={() => setTitleTarget(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              placeholder="Ej: VIP, Moderador Junior, Destacado..."
              maxLength={80}
              className="w-full liquid-glass-subtle border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
            />

            <div>
              <label className="text-xs text-slate-400 block mb-2 font-medium">Color de placa</label>
              <div className="grid grid-cols-6 gap-2.5">
                {TITLE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setTitleColor(color)}
                    className={`w-full h-10 rounded-xl transition-all flex items-center justify-center ${
                      titleColor === color
                        ? 'ring-2 ring-white scale-105 shadow-md shadow-black/40'
                        : 'opacity-40 hover:opacity-80'
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {titleColor === color && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setTitleTarget(null)}
                className="flex-1 px-4 py-2.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssignTitle}
                disabled={!titleText.trim()}
                className="flex-1 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-white text-sm font-semibold shadow-lg shadow-violet-500/25 transition-all cursor-pointer disabled:cursor-not-allowed"
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
    const el = document.createElement('div');
    el.className =
      'fixed bottom-5 right-5 liquid-glass border border-emerald-500/30 text-emerald-300 px-5 py-3 rounded-2xl shadow-xl shadow-black/40 z-50 text-sm font-medium flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 duration-200';
    el.innerHTML = `<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>${msg}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
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

