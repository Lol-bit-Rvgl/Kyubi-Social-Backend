'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  ShieldAlert,
  Gavel,
  Pin,
  Clock3,
  ArrowRight,
  Users,
  FileText,
  History,
  AlertTriangle,
} from 'lucide-react';
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

const ACTION_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  BAN_USER: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300' },
  SUSPEND_USER: { bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-300' },
  WARN: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-300' },
  MUTE_USER: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-300' },
  PIN_POST: { bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-300' },
  HIDE_POST: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-300' },
  RESOLVE_REPORT: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300' },
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Cabecera con Icono Lucide y degradado */}
      <div className="flex items-center gap-3.5 mb-6">
        <div className="p-3 rounded-2xl bg-gradient-to-tr from-violet-600/30 to-fuchsia-600/30 border border-white/15 shadow-lg shadow-violet-500/20 flex items-center justify-center">
          <LayoutDashboard className="w-6 h-6 text-violet-300" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Panel de Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Resumen en tiempo real del estado de moderación de Kyubi
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-950/40 border border-rose-900/60 rounded-2xl text-rose-300 text-sm backdrop-blur-md shadow-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Métricas con Liquid Glass y Squircles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        <MetricCard
          icon={ShieldAlert}
          label="Reportes pendientes"
          value={stats?.pendingReports}
          gradient="from-amber-500/20 via-orange-500/10 to-transparent"
          iconColor="text-amber-400"
          valueColor="bg-gradient-to-r from-amber-200 to-orange-400 bg-clip-text text-transparent"
          loading={loading}
        />
        <MetricCard
          icon={Gavel}
          label="Sanciones activas"
          value={stats?.activeSanctions}
          gradient="from-rose-500/20 via-pink-500/10 to-transparent"
          iconColor="text-rose-400"
          valueColor="bg-gradient-to-r from-rose-200 to-pink-400 bg-clip-text text-transparent"
          loading={loading}
        />
        <MetricCard
          icon={Pin}
          label="Posts fijados"
          value={
            stats ? `${stats.pinnedPosts} / ${stats.pinnedLimit}` : undefined
          }
          gradient="from-violet-500/20 via-indigo-500/10 to-transparent"
          iconColor="text-violet-400"
          valueColor="bg-gradient-to-r from-violet-200 to-indigo-400 bg-clip-text text-transparent"
          loading={loading}
        />
        <MetricCard
          icon={Clock3}
          label="Acciones de hoy"
          value={stats?.actionsToday}
          gradient="from-emerald-500/20 via-teal-500/10 to-transparent"
          iconColor="text-emerald-400"
          valueColor="bg-gradient-to-r from-emerald-200 to-teal-400 bg-clip-text text-transparent"
          loading={loading}
        />
      </div>

      {/* Actividad reciente + accesos rápidos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actividad reciente en Liquid Glass */}
        <div className="lg:col-span-2 rounded-3xl border border-white/10 backdrop-blur-xl bg-slate-950/65 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
            <h2 className="text-sm font-bold text-white tracking-wide">
              Actividad reciente
            </h2>
            <Link
              href="/admin/audit-logs"
              className="text-xs font-semibold text-violet-400 hover:text-violet-300 flex items-center gap-1 group transition-colors"
            >
              <span>Ver todo</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
          {loading ? (
            <div className="p-12 text-center text-slate-500 text-sm animate-pulse">
              Cargando registros recientes...
            </div>
          ) : !stats?.recent.length ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              No hay acciones registradas todavía
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06] flex-1">
              {stats.recent.map((log) => {
                const style = ACTION_STYLES[log.action] ?? {
                  bg: 'bg-white/5',
                  border: 'border-white/10',
                  text: 'text-slate-300',
                };
                return (
                  <li
                    key={log.id}
                    className="px-5 py-3.5 flex items-center gap-3.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <span
                      className={`text-[10px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${style.bg} ${style.border} ${style.text} shadow-sm`}
                    >
                      {log.action}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-200 font-medium truncate">
                        {log.reason || log.targetType}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        por @{log.moderator?.username ?? 'sistema'}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap bg-white/[0.03] px-2 py-0.5 rounded-lg border border-white/[0.06]">
                      {new Date(log.createdAt).toLocaleString('es', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Accesos rápidos en Liquid Glass */}
        <div className="rounded-3xl border border-white/10 backdrop-blur-xl bg-slate-950/65 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] p-5 space-y-3.5 flex flex-col">
          <h2 className="text-sm font-bold text-white tracking-wide">
            Accesos rápidos
          </h2>
          <div className="space-y-2 flex-1">
            <QuickLink
              href="/admin/reports"
              icon={ShieldAlert}
              label="Centro de Reportes"
              color="text-amber-400"
            />
            <QuickLink
              href="/admin/users"
              icon={Users}
              label="Gestión de Usuarios"
              color="text-violet-400"
            />
            <QuickLink
              href="/admin/posts"
              icon={FileText}
              label="Publicaciones & Feed"
              color="text-blue-400"
            />
            <QuickLink
              href="/admin/audit-logs"
              icon={History}
              label="Registro de Auditoría"
              color="text-teal-400"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  gradient,
  iconColor,
  valueColor,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number | string;
  gradient: string;
  iconColor: string;
  valueColor: string;
  loading: boolean;
}) {
  return (
    <div className="relative rounded-3xl border border-white/10 backdrop-blur-xl bg-slate-950/60 p-5 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] hover:border-white/20 transition-all duration-300 group overflow-hidden">
      {/* Sutil halo difuso de fondo */}
      <div
        className={`absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br ${gradient} blur-2xl pointer-events-none transition-opacity duration-300 group-hover:opacity-100 opacity-60`}
      />

      <div className="relative z-10 flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 shadow-sm flex items-center justify-center">
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      <p
        className={`relative z-10 mt-4 text-3xl font-black tracking-tight ${valueColor} ${
          loading ? 'animate-pulse opacity-40' : ''
        }`}
      >
        {loading ? '—' : (value ?? '0')}
      </p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  color,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3.5 py-3 rounded-2xl text-sm text-slate-300 hover:text-white bg-white/[0.02] hover:bg-gradient-to-r hover:from-violet-600/80 hover:to-indigo-600/80 border border-white/[0.06] hover:border-white/20 shadow-sm transition-all duration-200 group"
    >
      <Icon className={`w-4 h-4 ${color} group-hover:text-white transition-colors`} />
      <span className="font-medium">{label}</span>
      <ArrowRight className="ml-auto w-3.5 h-3.5 text-slate-500 group-hover:text-white/90 group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}
