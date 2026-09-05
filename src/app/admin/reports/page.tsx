'use client';

import { adminFetch } from '@/components/admin/api';
import { useState, useEffect } from 'react';
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

function ReportsContent() {
  const searchParams = useSearchParams();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<ReportStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<TargetType | ''>('');
  const [searchText, setSearchText] = useState('');

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
            {filteredReports.map((report) => (
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
                  {report.postId ? (
                    <a
                      href={`/admin/posts?search=${report.postId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 hover:text-violet-300 hover:underline font-medium cursor-pointer"
                      title={report.details || `Ver post ${report.postId}`}
                    >
                      {report.reason}
                      {report.details && (
                        <span className="block text-[11px] text-slate-500 font-normal mt-0.5 line-clamp-1">
                          {report.details}
                        </span>
                      )}
                    </a>
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
            ))}
          </tbody>
        </table>

        {filteredReports.length === 0 && (
          <div className="p-12 text-center text-slate-500">
            No se encontraron reportes con los filtros actuales
          </div>
        )}
      </div>
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
