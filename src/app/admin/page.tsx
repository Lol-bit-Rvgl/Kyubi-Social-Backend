'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/components/admin/api';

interface RecentLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  createdAt: string;
  moderator?: { id: string; username: string; avatarUrl?: string | null };
}

interface StatsData {
  pendingReports: number;
  activeSanctions: number;
  pinnedPosts: number;
  pinnedLimit: number;
  actionsToday: number;
  recent: RecentLog[];
}

const ACTION_COLORS: Record<string, string> = {
  BAN_USER: 'bg-red-900/30 text-red-400 border-red-800',
  SUSPEND_USER: 'bg-red-900/30 text-red-400 border-red-800',
  WARN: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
  MUTE_USER: 'bg-orange-900/30 text-orange-400 border-orange-800',
  PIN_POST: 'bg-violet-900/30 text-violet-400 border-violet-800',
  HIDE_POST: 'bg-blue-900/30 text-blue-400 border-blue-800',
  RESOLVE_REPORT: 'bg-emerald-900/30 text-emerald-400 border-emerald-800',
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminFetch('/api/admin/stats');
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const json = await res.json();
      setStats(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">📊 Panel de Control</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Resumen del estado de moderación de Kyubi
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-900 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon="🚨"
          label="Reportes pendientes"
          value={stats?.pendingReports}
          accent="text-yellow-400"
          loading={loading}
        />
        <MetricCard
          icon="⚖️"
          label="Sanciones activas"
          value={stats?.activeSanctions}
          accent="text-red-400"
          loading={loading}
        />
        <MetricCard
          icon="📌"
          label="Posts fijados"
          value={
            stats ? `${stats.pinnedPosts} / ${stats.pinnedLimit}` : undefined
          }
          accent="text-violet-400"
          loading={loading}
        />
        <MetricCard
          icon="🕒"
          label="Acciones de hoy"
          value={stats?.actionsToday}
          accent="text-emerald-400"
          loading={loading}
        />
      </div>

      {/* Actividad reciente + accesos rápidos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Actividad reciente */}
        <div className="xl:col-span-2 rounded-xl border border-neutral-900 bg-neutral-950">
          <div className="px-4 py-3 border-b border-neutral-900 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Actividad reciente</h2>
            <Link
              href="/admin/audit-logs"
              className="text-xs text-violet-400 hover:text-violet-300"
            >
              Ver todo →
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-neutral-600 text-sm animate-pulse">
              Cargando...
            </div>
          ) : !stats?.recent.length ? (
            <div className="p-8 text-center text-neutral-600 text-sm">
              No hay acciones registradas todavía
            </div>
          ) : (
            <ul className="divide-y divide-neutral-900">
              {stats.recent.map((log) => (
                <li key={log.id} className="px-4 py-3 flex items-center gap-3">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${
                      ACTION_COLORS[log.action] ??
                      'bg-neutral-800 text-neutral-300 border-neutral-700'
                    }`}
                  >
                    {log.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-neutral-300 truncate">
                      {log.reason || log.targetType}
                    </p>
                    <p className="text-[10px] text-neutral-600">
                      por @{log.moderator?.username ?? '—'}
                    </p>
                  </div>
                  <span className="text-[10px] text-neutral-600 font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString('es', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Accesos rápidos */}
        <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-4 space-y-3">
          <h2 className="text-sm font-bold text-white">Accesos rápidos</h2>
          <QuickLink href="/admin/reports" icon="🚨" label="Centro de Reportes" />
          <QuickLink href="/admin/users" icon="👥" label="Gestión de Usuarios" />
          <QuickLink href="/admin/posts" icon="📝" label="Publicaciones" />
          <QuickLink href="/admin/audit-logs" icon="📜" label="Audit Logs" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
  loading,
}: {
  icon: string;
  label: string;
  value?: number | string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </span>
      </div>
      <p
        className={`mt-3 text-3xl font-black ${accent} ${loading ? 'animate-pulse opacity-40' : ''}`}
      >
        {loading ? '—' : (value ?? '0')}
      </p>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-neutral-300 hover:bg-violet-600 hover:text-white transition-colors group"
    >
      <span>{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-neutral-600 group-hover:text-white/70">→</span>
    </Link>
  );
}
