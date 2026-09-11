'use client';

import { useState, useEffect, useCallback } from 'react';
import { Suspense } from 'react';
import {
  History,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Ban,
  ShieldCheck,
  MicOff,
  Volume2,
  PauseCircle,
  PlayCircle,
  EyeOff,
  Eye,
  Pin,
  PinOff,
  Tag,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  Crown,
  FileSpreadsheet,
  Activity,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

const ACTION_META: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  BAN_USER: { label: 'Ban', color: 'bg-rose-500/15 text-rose-300 border-rose-500/30', icon: Ban },
  UNBAN_USER: { label: 'Unban', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: ShieldCheck },
  MUTE_USER: { label: 'Mute', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: MicOff },
  UNMUTE_USER: { label: 'Unmute', color: 'bg-slate-800/40 text-slate-300 border-white/10', icon: Volume2 },
  WARN: { label: 'Warn', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: AlertTriangle },
  SUSPEND_USER: { label: 'Suspender', color: 'bg-rose-500/20 text-rose-300 border-rose-500/30', icon: PauseCircle },
  UNSUSPEND_USER: { label: 'Quitar suspensión', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: PlayCircle },
  HIDE_POST: { label: 'Ocultar Post', color: 'bg-violet-500/15 text-violet-300 border-violet-500/30', icon: EyeOff },
  UNHIDE_POST: { label: 'Mostrar Post', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', icon: Eye },
  PIN_POST: { label: 'Fijar Post', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30', icon: Pin },
  UNPIN_POST: { label: 'Desfijar Post', color: 'bg-slate-800/40 text-slate-300 border-white/10', icon: PinOff },
  HIDE_PROFILE: { label: 'Ocultar Perfil', color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30', icon: EyeOff },
  UNHIDE_PROFILE: { label: 'Mostrar Perfil', color: 'bg-teal-500/15 text-teal-300 border-teal-500/30', icon: Eye },
  ASSIGN_TITLE: { label: 'Asignar Título', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30', icon: Tag },
  REMOVE_TITLE: { label: 'Quitar Título', color: 'bg-slate-800/40 text-slate-300 border-white/10', icon: Trash2 },
  REVIEW_REPORT: { label: 'Revisar Reporte', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: Search },
  RESOLVE_REPORT: { label: 'Resolver Reporte', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
  DISMISS_REPORT: { label: 'Descartar Reporte', color: 'bg-slate-800/40 text-slate-400 border-white/10', icon: XCircle },
  DELETE_POST: { label: 'Eliminar Post', color: 'bg-rose-950/40 text-rose-400 border-rose-500/30', icon: Trash2 },
  DELETE_CIRCLE: { label: 'Eliminar Círculo', color: 'bg-rose-950/40 text-rose-400 border-rose-500/30', icon: Trash2 },
  DELETE_SALA: { label: 'Eliminar Sala', color: 'bg-rose-950/40 text-rose-400 border-rose-500/30', icon: Trash2 },
  CHANGE_ROLE: { label: 'Cambiar Rol', color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30', icon: Crown },
  DELETE_CONTENT: { label: 'Eliminar Contenido', color: 'bg-rose-950/40 text-rose-400 border-rose-500/30', icon: Trash2 },
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 shadow-md">
              <History className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Registro de Auditoría
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            Historial inmutable de acciones del staff · {total} eventos registrados
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          className="liquid-glass border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/50 cursor-pointer shadow-sm"
        >
          <option value="" className="bg-slate-950 text-white">Todas las acciones</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a} className="bg-slate-950 text-white">
              {ACTION_META[a].label}
            </option>
          ))}
        </select>
        <button
          onClick={loadLogs}
          className="liquid-glass border border-white/10 hover:border-violet-500/30 rounded-2xl px-4 py-2.5 text-sm text-slate-300 hover:text-white inline-flex items-center gap-2 transition-all cursor-pointer shadow-sm"
        >
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Recargar
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-rose-300 text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabla */}
      <div className="liquid-glass rounded-3xl border border-white/10 overflow-hidden shadow-xl shadow-black/25">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] border-b border-white/10">
              <tr>
                <th className="p-4 text-left text-slate-300 font-semibold text-xs tracking-wider uppercase">
                  Fecha
                </th>
                <th className="p-4 text-left text-slate-300 font-semibold text-xs tracking-wider uppercase">
                  Moderador
                </th>
                <th className="p-4 text-left text-slate-300 font-semibold text-xs tracking-wider uppercase">
                  Acción
                </th>
                <th className="p-4 text-left text-slate-300 font-semibold text-xs tracking-wider uppercase">
                  Objetivo
                </th>
                <th className="p-4 text-left text-slate-300 font-semibold text-xs tracking-wider uppercase">
                  Motivo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500">
                    Cargando historial de eventos...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-slate-500">
                    Sin entradas registradas en este período
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const meta = ACTION_META[log.action] || {
                    label: log.action,
                    color: 'bg-slate-800/40 text-slate-300 border-white/10',
                    icon: Activity,
                  };
                  const Icon = meta.icon;

                  return (
                    <tr key={log.id} className="hover:bg-white/[0.03] transition-colors">
                      <td className="p-4 text-slate-400 whitespace-nowrap font-mono text-xs">
                        {new Date(log.createdAt).toLocaleString('es', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2.5">
                          {log.moderator?.avatarUrl ? (
                            <img
                              src={log.moderator.avatarUrl}
                              className="w-7 h-7 rounded-xl object-cover border border-white/10"
                              alt=""
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-[10px] font-bold text-white border border-white/10">
                              {log.moderator?.username[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="text-slate-200 text-xs font-mono">
                            @{log.moderator?.username ?? log.moderatorId.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.color}`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300 text-xs">
                        <div>
                          <span className="text-slate-500 font-medium">{log.targetType}:</span>{' '}
                          <span className="font-mono text-slate-300">{log.targetId.slice(0, 12)}…</span>
                        </div>
                        {log.targetUserId && (
                          <div className="text-slate-500 text-[11px] mt-0.5 font-mono">
                            user: {log.targetUserId.slice(0, 8)}…
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-300 text-xs max-w-xs">
                        <div className="line-clamp-2">
                          {log.reason || <span className="text-slate-600 italic">—</span>}
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <details className="text-[11px] text-slate-500 mt-1 cursor-pointer group">
                            <summary className="hover:text-slate-300 font-medium">Ver metadata</summary>
                            <pre className="liquid-glass-subtle border border-white/10 p-2.5 rounded-xl mt-1.5 overflow-x-auto text-slate-300 font-mono text-[10px]">
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
      <div className="flex items-center justify-center gap-3 pt-4">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="liquid-glass px-4 py-2 rounded-xl text-sm border border-white/10 text-slate-300 hover:border-violet-500/40 disabled:opacity-30 disabled:hover:border-white/10 inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Anterior
        </button>
        <span className="px-4 py-2 text-sm text-slate-400 font-medium">
          Página {page} de {Math.max(1, totalPages)}
        </span>
        <button
          disabled={page >= totalPages}
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

