'use client';

import { adminFetch } from '@/components/admin/api';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

type ReportStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
type TargetType = 'USER' | 'POST' | 'MESSAGE' | 'COMMENT' | 'CIRCLE';

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
    <div className="p-6">
      {/* Filters */}
      <div className="mb-6 space-y-4">
        <div className="flex gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReportStatus)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los estados</option>
            <option value="OPEN">Abierto</option>
            <option value="REVIEWING">En revisión</option>
            <option value="RESOLVED">Resuelto</option>
            <option value="DISMISSED">Descartado</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TargetType)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            <option value="USER">Usuario</option>
            <option value="POST">Publicación</option>
            <option value="MESSAGE">Mensaje</option>
            <option value="COMMENT">Comentario</option>
            <option value="CIRCLE">Círculo</option>
          </select>

          <input
            type="text"
            placeholder="Buscar..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              <th className="p-3 text-left">Fecha</th>
              <th className="p-3 text-center">Tipo</th>
              <th className="p-3 text-left">Razón</th>
              <th className="p-3 text-left">Reportado por</th>
              <th className="p-3 text-left">Usuario denunciado</th>
              <th className="p-3 text-left">Estado</th>
              <th className="p-3 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredReports.map((report) => {
              const isPost = report.targetType === 'POST' || !!report.postId;
              return (
                <tr key={report.id} className="hover:bg-slate-800/50">
                  <td className="p-3 text-slate-400">
                    {new Date(report.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-center">
                      <span className="inline-flex items-center justify-center capitalize bg-slate-800/70 border border-slate-700 rounded-md px-2.5 py-1 text-[11px] text-slate-300">
                        {report.targetType}
                      </span>
                    </div>
                  </td>
                  <td className="p-3">
                    {isPost ? (
                      <button
                        onClick={() => openDrawer(report)}
                        className="text-left text-violet-400 hover:text-violet-300 hover:underline font-medium cursor-pointer"
                        title={report.details || `Inspeccionar post ${report.postId ?? report.targetId}`}
                      >
                        {report.reason}
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
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {report.reporter?.avatarUrl ? (
                        <img
                          src={report.reporter.avatarUrl}
                          alt=""
                          className="w-6 h-6 rounded-full bg-slate-700"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-700" />
                      )}
                      <span>
                        {report.reporter?.displayName ??
                          report.reporter?.username ??
                          report.reporterId.slice(0, 8)}
                      </span>
                    </div>
                  </td>
                  <td className="p-3">{report.reportedUser?.username ?? '—'}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        report.status === 'RESOLVED'
                          ? 'bg-green-600/20 text-green-400'
                          : report.status === 'DISMISSED'
                            ? 'bg-slate-600/20 text-slate-400'
                            : report.status === 'OPEN'
                              ? 'bg-yellow-600/20 text-yellow-400'
                              : 'bg-blue-600/20 text-blue-400'
                      }`}
                    >
                      {report.status}
                    </span>
                  </td>
                  <td className="p-3 space-x-2">
                    {isPost && (
                      <button
                        onClick={() => openDrawer(report)}
                        className="text-xs bg-violet-600/20 text-violet-300 px-2 py-1 rounded hover:bg-violet-600/30"
                      >
                        Inspeccionar
                      </button>
                    )}
                    <button
                      onClick={() => handleUpdateStatus(report.id, 'REVIEWING')}
                      className="text-xs bg-blue-600/20 text-blue-400 px-2 py-1 rounded hover:bg-blue-600/30"
                    >
                      Revisar
                    </button>
                    <button
                      onClick={() =>
                        handleUpdateStatus(report.id, 'DISMISSED', 'No action needed')
                      }
                      className="text-xs bg-slate-600/20 text-slate-400 px-2 py-1 rounded hover:bg-slate-600/30"
                    >
                      Descartar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredReports.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            No se encontraron reportes con los filtros actuales
          </div>
        )}
      </div>

      {/* ── Drawer / Modal Lateral de Inspección ── */}
      {inspectingPostId != null && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          onClick={closeDrawer}
        >
          <div
            className="w-full max-w-lg h-full bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Cabecera del drawer */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/50">
              <div>
                <h2 className="text-sm font-bold text-white">Inspección de publicación</h2>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                  {inspectingPostId}
                </p>
              </div>
              <button
                onClick={closeDrawer}
                disabled={actionLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700/60 text-slate-300 hover:bg-slate-600/60 disabled:opacity-40"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* Contenido del drawer */}
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              {detailLoading && (
                <div className="py-16 text-center">
                  <div className="inline-block w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <p className="mt-3 text-sm text-slate-400">Cargando publicación...</p>
                </div>
              )}

              {drawerError && !detailLoading && (
                <div className="py-10 text-center">
                  <p className="text-red-400 text-sm">Error: {drawerError}</p>
                </div>
              )}

              {postDetail && !detailLoading && (
                <>
                  {/* Cabecera del autor */}
                  <div className="flex items-center gap-3">
                    {postDetail.author.avatarUrl ? (
                      <img
                        src={postDetail.author.avatarUrl}
                        alt={postDetail.author.username}
                        className="w-11 h-11 rounded-full bg-slate-700 object-cover"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                        👤
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white truncate">
                          {postDetail.author.displayName}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          @{postDetail.author.username}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 uppercase">
                          {postDetail.author.role}
                        </span>
                        {postDetail.author.isSuspended && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-600/20 text-yellow-400 uppercase">
                            Suspendido
                          </span>
                        )}
                        {postDetail.author.isBanned && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 uppercase">
                            Baneado
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {postDetail.author.email}
                      </p>
                    </div>
                  </div>

                  {/* Post content */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    {postDetail.coverImageUrl && (
                      <img
                        src={postDetail.coverImageUrl}
                        alt=""
                        className="w-full h-36 object-cover bg-slate-800"
                      />
                    )}
                    <div className="p-3">
                      {postDetail.title && (
                        <h3 className="text-sm font-bold text-white mb-1.5">
                          {postDetail.title}
                        </h3>
                      )}
                      <p className="text-[13px] leading-relaxed text-slate-300 whitespace-pre-wrap">
                        {postDetail.content || '— Sin contenido —'}
                      </p>
                      {postDetail.mediaUrls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {postDetail.mediaUrls.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt={`media-${i}`}
                              className="w-20 h-20 rounded-lg object-cover border border-slate-700 bg-slate-800"
                            />
                          ))}
                        </div>
                      )}
                      {postDetail.audioUrl && (
                        <div className="mt-2">
                          <audio controls className="w-full h-9" src={postDetail.audioUrl}>
                            Tu navegador no soporta audio
                          </audio>
                        </div>
                      )}
                      {postDetail.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {postDetail.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
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
                        <div className="mt-2 text-[11px] text-red-400 border border-red-600/20 bg-red-600/10 rounded-lg px-2 py-1.5">
                          ⚠️ Post oculto
                          {postDetail.hiddenReason && ` — ${postDetail.hiddenReason}`}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Caja de la denuncia */}
                  {inspectingReport && (
                    <div className="border border-amber-600/20 bg-amber-600/5 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-amber-400">Denuncia</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            inspectingReport.status === 'RESOLVED'
                              ? 'bg-green-600/20 text-green-400'
                              : inspectingReport.status === 'DISMISSED'
                                ? 'bg-slate-600/20 text-slate-400'
                                : inspectingReport.status === 'OPEN'
                                  ? 'bg-yellow-600/20 text-yellow-400'
                                  : 'bg-blue-600/20 text-blue-400'
                          }`}
                        >
                          {inspectingReport.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-white">
                        {inspectingReport.reason}
                      </p>
                      {inspectingReport.details && (
                        <p className="mt-1 text-xs text-slate-400">
                          {inspectingReport.details}
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        Reportado por{' '}
                        {inspectingReport.reporter?.displayName ??
                          inspectingReport.reporter?.username ??
                          'usuario'}
                        {' · '}
                        {new Date(inspectingReport.createdAt).toLocaleString()}
                      </p>
                      {inspectingReport.reportedUser && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Usuario denunciado: @{inspectingReport.reportedUser.username}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Barra de acciones */}
            {postDetail && !detailLoading && (
              <div className="p-4 border-t border-slate-800 bg-slate-800/30 space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleVisibility(postDetail.id, !postDetail.isHidden)}
                    disabled={actionLoading}
                    className={`flex-1 text-xs px-3 py-2.5 rounded-lg font-semibold disabled:opacity-50 ${
                      postDetail.isHidden
                        ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                        : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                    }`}
                  >
                    {actionLoading
                      ? 'Procesando...'
                      : postDetail.isHidden
                        ? 'Restaurar Post'
                        : 'Ocultar Post'}
                  </button>
                  <button
                    onClick={() => handleSuspendUser(postDetail.author.id)}
                    disabled={actionLoading}
                    className="flex-1 text-xs px-3 py-2.5 rounded-lg font-semibold bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-50"
                  >
                    Suspender Usuario
                  </button>
                </div>
                {inspectingReport && (
                  <button
                    onClick={() => handleDismissFromDrawer(inspectingReport.id)}
                    disabled={actionLoading}
                    className="w-full text-xs px-3 py-2.5 rounded-lg font-semibold bg-slate-600/20 text-slate-300 hover:bg-slate-600/30 disabled:opacity-50"
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