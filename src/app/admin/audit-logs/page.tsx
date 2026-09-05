'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import { adminFetch } from '@/components/admin/api';

interface ModerationLog {
  id: string;
  moderatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  targetUserId?: string | null;
  targetPostId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  moderator?: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    role: string;
  };
}

const ACTION_META: Record<string, { label: string; color: string; icon: string }> = {
  BAN_USER: { label: 'Ban', color: 'bg-red-600/20 text-red-400 border-red-800', icon: '🔨' },
  UNBAN_USER: { label: 'Unban', color: 'bg-emerald-600/20 text-emerald-400 border-emerald-800', icon: '✓' },
  MUTE_USER: { label: 'Mute', color: 'bg-orange-600/20 text-orange-400 border-orange-800', icon: '🔇' },
  UNMUTE_USER: { label: 'Unmute', color: 'bg-slate-700/40 text-slate-300 border-slate-700', icon: '🔊' },
  WARN: { label: 'Warn', color: 'bg-yellow-600/20 text-yellow-400 border-yellow-800', icon: '⚠️' },
  SUSPEND_USER: { label: 'Suspender', color: 'bg-red-800/30 text-red-300 border-red-900', icon: '⏸️' },
  UNSUSPEND_USER: { label: 'Quitar suspensión', color: 'bg-emerald-800/30 text-emerald-300 border-emerald-900', icon: '▶️' },
  HIDE_POST: { label: 'Ocultar Post', color: 'bg-violet-600/20 text-violet-400 border-violet-800', icon: '🙈' },
  UNHIDE_POST: { label: 'Mostrar Post', color: 'bg-cyan-600/20 text-cyan-400 border-cyan-800', icon: '👁️' },
  PIN_POST: { label: 'Fijar Post', color: 'bg-purple-600/20 text-purple-400 border-purple-800', icon: '📌' },
  UNPIN_POST: { label: 'Desfijar Post', color: 'bg-slate-700/40 text-slate-300 border-slate-700', icon: '📍' },
  HIDE_PROFILE: { label: 'Ocultar Perfil', color: 'bg-fuchsia-600/20 text-fuchsia-400 border-fuchsia-800', icon: '👤' },
  UNHIDE_PROFILE: { label: 'Mostrar Perfil', color: 'bg-teal-600/20 text-teal-400 border-teal-800', icon: '👤' },
  ASSIGN_TITLE: { label: 'Asignar Título', color: 'bg-indigo-600/20 text-indigo-400 border-indigo-800', icon: '🏷️' },
  REMOVE_TITLE: { label: 'Quitar Título', color: 'bg-slate-700/40 text-slate-300 border-slate-700', icon: '🗑️' },
  REVIEW_REPORT: { label: 'Revisar Reporte', color: 'bg-blue-600/20 text-blue-400 border-blue-800', icon: '🔍' },
  RESOLVE_REPORT: { label: 'Resolver Reporte', color: 'bg-emerald-600/20 text-emerald-400 border-emerald-800', icon: '✅' },
  DISMISS_REPORT: { label: 'Descartar Reporte', color: 'bg-slate-700/40 text-slate-400 border-slate-700', icon: '✗' },
  DELETE_POST: { label: 'Eliminar Post', color: 'bg-red-900/40 text-red-400 border-red-900', icon: '🗑️' },
  DELETE_CIRCLE: { label: 'Eliminar Círculo', color: 'bg-red-900/40 text-red-400 border-red-900', icon: '🗑️' },
  DELETE_SALA: { label: 'Eliminar Sala', color: 'bg-red-900/40 text-red-400 border-red-900', icon: '🗑️' },
  CHANGE_ROLE: { label: 'Cambiar Rol', color: 'bg-fuchsia-700/30 text-fuchsia-300 border-fuchsia-800', icon: '👑' },
  DELETE_CONTENT: { label: 'Eliminar Contenido', color: 'bg-red-900/40 text-red-400 border-red-900', icon: '🗑️' },
};

const ALL_ACTIONS = Object.keys(ACTION_META);

function AuditLogsContent() {
  const [logs, setLogs] = useState<ModerationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('');
  const limit = 25;

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (actionFilter) params.set('action', actionFilter);
      const res = await adminFetch(`/api/admin/audit-logs?${params}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setLogs(data.data || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando logs');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">📜 Registro de Auditoría</h1>
        <p className="text-sm text-slate-400">
          Historial inmutable de acciones del staff · {total} eventos registrados
        </p>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-3 items-center">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Todas las acciones</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {ACTION_META[a].icon} {ACTION_META[a].label}
            </option>
          ))}
        </select>
        <button
          onClick={loadLogs}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
        >
          ↻ Recargar
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 border-b border-slate-700">
              <tr>
                <th className="p-3 text-left text-slate-300 font-semibold text-xs">
                  Fecha
                </th>
                <th className="p-3 text-left text-slate-300 font-semibold text-xs">
                  Moderador
                </th>
                <th className="p-3 text-left text-slate-300 font-semibold text-xs">
                  Acción
                </th>
                <th className="p-3 text-left text-slate-300 font-semibold text-xs">
                  Objetivo
                </th>
                <th className="p-3 text-left text-slate-300 font-semibold text-xs">
                  Motivo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    Cargando historial...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500">
                    Sin entradas registradas
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const meta = ACTION_META[log.action] || {
                    label: log.action,
                    color: 'bg-slate-700/40 text-slate-300 border-slate-700',
                    icon: '•',
                  };
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 text-slate-400 whitespace-nowrap font-mono text-xs">
                        {new Date(log.createdAt).toLocaleString('es', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {log.moderator?.avatarUrl ? (
                            <img
                              src={log.moderator.avatarUrl}
                              className="w-6 h-6 rounded-full"
                              alt=""
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-purple-700 flex items-center justify-center text-[10px] font-bold text-white">
                              {log.moderator?.username[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="text-slate-300 text-xs">
                            @{log.moderator?.username ?? log.moderatorId.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold border ${meta.color}`}
                        >
                          <span>{meta.icon}</span>
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 text-xs">
                        <div>
                          <span className="text-slate-500">{log.targetType}:</span>{' '}
                          <span className="font-mono">{log.targetId.slice(0, 12)}…</span>
                        </div>
                        {log.targetUserId && (
                          <div className="text-slate-600 text-[10px] mt-0.5">
                            user: {log.targetUserId.slice(0, 8)}…
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-400 text-xs max-w-xs">
                        <div className="line-clamp-2">
                          {log.reason || <span className="text-slate-600 italic">—</span>}
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <details className="text-[10px] text-slate-600 mt-1 cursor-pointer">
                            <summary className="hover:text-slate-400">metadata</summary>
                            <pre className="bg-slate-950/50 p-1.5 rounded mt-1 overflow-x-auto">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-center gap-2 mt-6">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="px-4 py-2 text-sm text-slate-400">
          Página {page} de {Math.max(1, totalPages)}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-slate-400">Cargando historial...</div>
      }
    >
      <AuditLogsContent />
    </Suspense>
  );
}
