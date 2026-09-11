'use client';

import { adminFetch } from '@/components/admin/api';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  ShieldAlert,
  Filter,
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  Clock,
  User,
  SlidersHorizontal,
  EyeOff,
  UserX,
  AlertTriangle,
} from 'lucide-react';

type ReportStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
type TargetType = 'USER' | 'POST' | 'MESSAGE' | 'COMMENT' | 'CIRCLE';

const STATUS_STYLES: Record<ReportStatus, string> = {
  RESOLVED: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-500/10',
  DISMISSED: 'bg-slate-500/10 text-slate-400 border border-slate-500/30',
  OPEN: 'bg-amber-500/10 text-amber-300 border border-amber-500/30 shadow-sm shadow-amber-500/10',
  REVIEWING: 'bg-blue-500/10 text-blue-300 border border-blue-500/30 shadow-sm shadow-blue-500/10',
};

interface Report {
  id: string;
  targetType: TargetType;
  targetId: string;
  reporterId: string;
  reason: string;
  details?: string | null;
  status: ReportStatus;
  createdAt: string;
  postId?: string | null;
  postExcerpt?: string | null;
  reporter?: { id: string; username: string; displayName?: string | null; avatarUrl?: string | null } | null;
  reportedUser?: { id: string; username: string; displayName?: string | null } | null;
}

interface PostDetail {
  id: string;
  title?: string | null;
  content: string;
  type: string;
  visibility: string;
  mediaUrls: string[];
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  tags: string[];
  genres?: string[];
  isPinned: boolean;
  isHidden: boolean;
  hiddenReason?: string | null;
  createdAt?: string | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    email: string;
    avatarUrl?: string | null;
    role: string;
    isSuspended: boolean;
    isBanned: boolean;
  };
}

function ReportsContent() {
  const searchParams = useSearchParams();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<ReportStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<TargetType | ''>('');
  const [searchText, setSearchText] = useState('');

  // Drawer de inspección de post reportado
  const [inspectingPostId, setInspectingPostId] = useState<string | null>(null);
  const [inspectingReport, setInspectingReport] = useState<Report | null>(null);
  const [postDetail, setPostDetail] = useState<PostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        const url = new URL('/api/admin/reports', window.location.origin);
        if (statusFilter) url.searchParams.set('status', statusFilter);
        if (typeFilter) url.searchParams.set('targetType', typeFilter);

        const res = await adminFetch(url);
        if (!res.ok) throw new Error('Failed to load reports');

        const json = await res.json();
        const list = json.data || json.reports || json.items || [];
        setReports(Array.isArray(list) ? list : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    const statusParam = searchParams.get('status');
    const typeParam = searchParams.get('targetType');
    if (statusParam) setStatusFilter(statusParam as ReportStatus);
    if (typeParam) setTypeFilter(typeParam as TargetType);
  }, [searchParams]);

  const handleUpdateStatus = async (id: string, newStatus: ReportStatus, notes?: string) => {
    try {
      const res = await adminFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, resolutionNotes: notes }),
      });
      if (!res.ok) throw new Error('Failed to update report');

      // Optimistic update
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r))
      );
    } catch (err) {
      console.error(err);
      alert('Error updating report');
    }
  };

  // ── Cerrar drawer con la tecla Escape ──
  useEffect(() => {
    if (inspectingPostId == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectingPostId]);

  const closeDrawer = useCallback(() => {
    if (actionLoading) return;
    setInspectingPostId(null);
    setInspectingReport(null);
    setPostDetail(null);
    setDrawerError(null);
  }, [actionLoading]);

  const openDrawer = async (report: Report) => {
    const postId = report.postId ?? report.targetId;
    if (!postId) return;
    setInspectingPostId(postId);
    setInspectingReport(report);
    setPostDetail(null);
    setDrawerError(null);
    setDetailLoading(true);

    try {
      const res = await adminFetch(`/api/admin/posts/${postId}`);
      if (!res.ok) throw new Error('No se pudo cargar la publicación');
      const json = await res.json();
      const detail = (json.data ?? json) as PostDetail;
      setPostDetail(detail);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Error cargando el post');
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Acciones de moderación ──
  const handleToggleVisibility = async (postId: string, isHidden: boolean) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const reason = isHidden ? 'Contenido denunciado por la comunidad' : 'Restaurado tras revisión';
      const res = await adminFetch(`/api/admin/posts/${postId}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden, reason }),
      });
      if (!res.ok) throw new Error('Failed to change post visibility');
      setPostDetail((prev) => (prev ? { ...prev, isHidden } : prev));
    } catch (err) {
      console.error(err);
      alert('Error al cambiar la visibilidad del post');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspendUser = async (authorId: string) => {
    if (actionLoading) return;
    if (!authorId) {
      alert('No hay usuario autor asociado a este post');
      return;
    }
    if (!window.confirm('¿Suspender al autor de este post por 24 horas?')) return;
    setActionLoading(true);
    try {
      const res = await adminFetch(`/api/admin/users/${authorId}/sanction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUSPEND',
          reason: 'Contenido denunciado en el panel de moderación',
          durationHours: 24,
        }),
      });
      if (!res.ok) throw new Error('Failed to suspend user');
      setPostDetail((prev) => (prev ? { ...prev, author: { ...prev.author, isSuspended: true } } : prev));
    } catch (err) {
      console.error(err);
      alert('Error al suspender al usuario');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismissFromDrawer = async (reportId: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await handleUpdateStatus(reportId, 'DISMISSED', 'Revisado desde el panel');
      closeDrawer();
    } finally {
      setActionLoading(false);
    }
  };

  const filteredReports = reports.filter((r) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return [r.reporter?.username, r.reason, r.details, r.targetId].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="p-8 text-center text-slate-400">Cargando reportes...</div>;
  if (error) return <div className="p-8 text-center text-red-400">Error: {error}</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Cabecera */}
      <div className="flex items-center gap-3.5 mb-6">
        <div className="p-3 rounded-2xl bg-gradient-to-tr from-amber-500/25 to-orange-500/25 border border-white/15 shadow-lg shadow-amber-500/15 flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-amber-300" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Centro de Reportes
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Monitoreo y resolución de denuncias de la comunidad Kyubi
          </p>
        </div>
      </div>

      {/* Filters con Liquid Glass */}
      <div className="rounded-3xl border border-white/10 backdrop-blur-xl bg-slate-950/60 p-4 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)]">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReportStatus)}
              className="w-full sm:w-auto bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-violet-500/50 appearance-none pr-9 cursor-pointer shadow-sm"
            >
              <option value="">Todos los estados</option>
              <option value="OPEN">Abierto</option>
              <option value="REVIEWING">En revisión</option>
              <option value="RESOLVED">Resuelto</option>
              <option value="DISMISSED">Descartado</option>
            </select>
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TargetType)}
              className="w-full sm:w-auto bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-violet-500/50 appearance-none pr-9 cursor-pointer shadow-sm"
            >
              <option value="">Todos los tipos</option>
              <option value="USER">Usuario</option>
              <option value="POST">Publicación</option>
              <option value="MESSAGE">Mensaje</option>
              <option value="COMMENT">Comentario</option>
              <option value="CIRCLE">Círculo</option>
            </select>
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar por usuario, razón, detalles..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-slate-900/80 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/50 shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* Table con Liquid Glass */}
      <div className="rounded-3xl border border-white/10 backdrop-blur-xl bg-slate-950/65 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-xs">
            <thead className="bg-white/[0.03] border-b border-white/[0.08]">
              <tr>
                <th className="p-3.5 text-left font-semibold text-slate-400">Fecha</th>
                <th className="p-3.5 text-center font-semibold text-slate-400">Tipo</th>
                <th className="p-3.5 text-left font-semibold text-slate-400">Razón</th>
                <th className="p-3.5 text-left font-semibold text-slate-400">Reportado por</th>
                <th className="p-3.5 text-left font-semibold text-slate-400">Usuario denunciado</th>
                <th className="p-3.5 text-left font-semibold text-slate-400">Estado</th>
                <th className="p-3.5 text-left font-semibold text-slate-400">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filteredReports.map((report) => {
                const isPost = report.targetType === 'POST' || !!report.postId;
                return (
                  <tr key={report.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3.5 text-slate-400 font-mono">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center justify-center">
                        <span className="inline-flex items-center justify-center capitalize bg-white/[0.03] border border-white/10 rounded-xl px-2.5 py-1 text-[11px] text-slate-300 font-medium">
                          {report.targetType}
                        </span>
                      </div>
                    </td>
                    <td className="p-3.5">
                      {isPost ? (
                        <button
                          onClick={() => openDrawer(report)}
                          className="text-left text-violet-300 hover:text-violet-200 font-medium cursor-pointer transition-colors group"
                          title={report.details || `Inspeccionar post ${report.postId ?? report.targetId}`}
                        >
                          <span className="group-hover:underline">{report.reason}</span>
                          {report.details && (
                            <span className="block text-[11px] text-slate-500 font-normal mt-0.5 line-clamp-1">
                              {report.details}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span
                          className="text-purple-300 font-medium"
                          title={report.details ?? undefined}
                        >
                          {report.reason}
                          {report.details && (
                            <span className="block text-[11px] text-slate-500 font-normal mt-0.5 line-clamp-1">
                              {report.details}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        {report.reporter?.avatarUrl ? (
                          <img
                            src={report.reporter.avatarUrl}
                            alt=""
                            className="w-6 h-6 rounded-lg bg-slate-800 object-cover ring-1 ring-white/15"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 ring-1 ring-white/15">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                          </div>
                        )}
                        <span className="text-slate-200 font-medium">
                          {report.reporter?.displayName ??
                            report.reporter?.username ??
                            report.reporterId.slice(0, 8)}
                        </span>
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-300 font-medium">
                      {report.reportedUser ? (
                        <span>@{report.reportedUser.username}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${
                          STATUS_STYLES[report.status] ?? 'bg-white/5 text-slate-400'
                        }`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1.5 justify-start items-center">
                        {isPost && (
                          <button
                            onClick={() => openDrawer(report)}
                            className="text-[11px] font-semibold bg-gradient-to-r from-violet-600/80 to-indigo-600/80 hover:from-violet-500 hover:to-indigo-500 text-white px-2.5 py-1 rounded-xl shadow-sm shadow-violet-500/20 border border-white/10 transition-all whitespace-nowrap flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Inspeccionar</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdateStatus(report.id, 'REVIEWING')}
                          className="text-[11px] font-semibold bg-gradient-to-r from-blue-600/80 to-cyan-600/80 hover:from-blue-500 hover:to-cyan-500 text-white px-2.5 py-1 rounded-xl shadow-sm shadow-blue-500/20 border border-white/10 transition-all whitespace-nowrap"
                        >
                          Revisar
                        </button>
                        <button
                          onClick={() =>
                            handleUpdateStatus(report.id, 'DISMISSED', 'No action needed')
                          }
                          className="text-[11px] font-semibold bg-white/5 hover:bg-white/10 text-slate-300 px-2.5 py-1 rounded-xl border border-white/10 transition-colors whitespace-nowrap"
                        >
                          Descartar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredReports.length === 0 && (
          <div className="p-14 text-center text-slate-500 text-sm">
            No se encontraron reportes con los filtros actuales
          </div>
        )}
      </div>

      {/* ── Drawer / Modal Lateral de Inspección con Liquid Glass ── */}
      {inspectingPostId != null && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-md animate-fade-in"
          onClick={closeDrawer}
        >
          <div
            className="w-full max-w-lg h-full backdrop-blur-2xl bg-slate-950/95 border-l border-white/15 shadow-2xl overflow-y-auto flex flex-col sm:rounded-l-3xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Cabecera del drawer */}
            <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-white/[0.02]">
              <div>
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Inspección de publicación
                </h2>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  {inspectingPostId}
                </p>
              </div>
              <button
                onClick={closeDrawer}
                disabled={actionLoading}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 border border-white/10 disabled:opacity-40 transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Contenido del drawer */}
            <div className="flex-1 p-5 space-y-4 overflow-y-auto">
              {detailLoading && (
                <div className="py-20 text-center">
                  <div className="inline-block w-7 h-7 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-3 text-xs text-slate-400">Cargando publicación...</p>
                </div>
              )}

              {drawerError && !detailLoading && (
                <div className="p-4 bg-rose-950/50 border border-rose-900/60 rounded-2xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Error: {drawerError}</span>
                </div>
              )}

              {postDetail && !detailLoading && (
                <>
                  {/* Cabecera del autor */}
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.08]">
                    {postDetail.author.avatarUrl ? (
                      <img
                        src={postDetail.author.avatarUrl}
                        alt={postDetail.author.username}
                        className="w-11 h-11 rounded-xl bg-slate-800 object-cover ring-1 ring-white/15"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 ring-1 ring-white/15">
                        <User className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-xs truncate">
                          {postDetail.author.displayName}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          @{postDetail.author.username}
                        </span>
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 uppercase">
                          {postDetail.author.role}
                        </span>
                        {postDetail.author.isSuspended && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 uppercase">
                            Suspendido
                          </span>
                        )}
                        {postDetail.author.isBanned && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 uppercase">
                            Baneado
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {postDetail.author.email}
                      </p>
                    </div>
                  </div>

                  {/* Post content con Liquid Glass */}
                  <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/[0.02]">
                    {postDetail.coverImageUrl && (
                      <img
                        src={postDetail.coverImageUrl}
                        alt=""
                        className="w-full h-36 object-cover bg-slate-900"
                      />
                    )}
                    <div className="p-3.5">
                      {postDetail.title && (
                        <h3 className="text-sm font-bold text-white mb-1.5">
                          {postDetail.title}
                        </h3>
                      )}
                      <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                        {postDetail.content || '— Sin contenido —'}
                      </p>
                      {postDetail.mediaUrls.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {postDetail.mediaUrls.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt={`media-${i}`}
                              className="w-20 h-20 rounded-xl object-cover border border-white/10 bg-slate-900"
                            />
                          ))}
                        </div>
                      )}
                      {postDetail.audioUrl && (
                        <div className="mt-2.5">
                          <audio controls className="w-full h-9" src={postDetail.audioUrl}>
                            Tu navegador no soporta audio
                          </audio>
                        </div>
                      )}
                      {postDetail.tags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {postDetail.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-2 py-0.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                        <span>Visibilidad: {postDetail.visibility}</span>
                        <span>·</span>
                        <span>Tipo: {postDetail.type}</span>
                        <span>·</span>
                        <span>
                          {postDetail.createdAt
                            ? new Date(postDetail.createdAt).toLocaleString()
                            : '—'}
                        </span>
                      </div>
                      {postDetail.isHidden && (
                        <div className="mt-2.5 text-[11px] text-rose-300 border border-rose-500/30 bg-rose-500/10 rounded-xl p-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>
                            Post oculto
                            {postDetail.hiddenReason && ` — ${postDetail.hiddenReason}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Caja de la denuncia */}
                  {inspectingReport && (
                    <div className="border border-amber-500/25 bg-amber-500/5 rounded-2xl p-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-amber-300">Denuncia</span>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                            STATUS_STYLES[inspectingReport.status]
                          }`}
                        >
                          {inspectingReport.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-white">
                        {inspectingReport.reason}
                      </p>
                      {inspectingReport.details && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          {inspectingReport.details}
                        </p>
                      )}
                      <p className="mt-2 text-[10px] text-slate-500">
                        Reportado por{' '}
                        {inspectingReport.reporter?.displayName ??
                          inspectingReport.reporter?.username ??
                          'usuario'}
                        {' · '}
                        {new Date(inspectingReport.createdAt).toLocaleString()}
                      </p>
                      {inspectingReport.reportedUser && (
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          Usuario denunciado: @{inspectingReport.reportedUser.username}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Barra de acciones en degradados sutiles */}
            {postDetail && !detailLoading && (
              <div className="p-4 border-t border-white/[0.08] bg-white/[0.02] space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleVisibility(postDetail.id, !postDetail.isHidden)}
                    disabled={actionLoading}
                    className={`flex-1 text-xs px-3 py-2.5 rounded-2xl font-bold disabled:opacity-50 transition-all shadow-md flex items-center justify-center gap-1.5 ${
                      postDetail.isHidden
                        ? 'bg-gradient-to-r from-emerald-500/80 via-teal-500/80 to-cyan-500/80 hover:from-emerald-400 hover:to-cyan-400 text-white shadow-teal-500/20'
                        : 'bg-gradient-to-r from-rose-500/80 via-pink-500/80 to-purple-600/80 hover:from-rose-400 hover:to-purple-500 text-white shadow-rose-500/20'
                    }`}
                  >
                    {postDetail.isHidden ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>Restaurar Post</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Ocultar Post</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleSuspendUser(postDetail.author.id)}
                    disabled={actionLoading}
                    className="flex-1 text-xs px-3 py-2.5 rounded-2xl font-bold bg-gradient-to-r from-amber-500/80 to-orange-600/80 hover:from-amber-400 hover:to-orange-500 text-white shadow-md shadow-amber-500/20 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Suspender Usuario</span>
                  </button>
                </div>
                {inspectingReport && (
                  <button
                    onClick={() => handleDismissFromDrawer(inspectingReport.id)}
                    disabled={actionLoading}
                    className="w-full text-xs px-3 py-2.5 rounded-2xl font-semibold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    Descartar Reporte
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Cargando reportes...</div>}>
      <ReportsContent />
    </Suspense>
  );
}