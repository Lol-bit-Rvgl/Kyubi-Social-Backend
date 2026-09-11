'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ShieldAlert,
  Users,
  FileText,
  History,
  Menu,
  X,
  Activity,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/reports', label: 'Reportes', icon: ShieldAlert },
  { href: '/admin/users', label: 'Usuarios', icon: Users },
  { href: '/admin/posts', label: 'Publicaciones', icon: FileText },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: History },
];

const STAFF_ROLES = ['MODERATOR', 'ADMIN', 'OWNER'];

interface AdminUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: string;
}

const ROLE_STYLES: Record<string, string> = {
  OWNER: 'bg-gradient-to-r from-red-500/80 to-rose-600/80 text-white shadow-sm shadow-red-500/20 border border-red-400/30',
  ADMIN: 'bg-gradient-to-r from-violet-500/80 to-purple-600/80 text-white shadow-sm shadow-purple-500/20 border border-violet-400/30',
  MODERATOR: 'bg-gradient-to-r from-teal-500/80 to-emerald-600/80 text-white shadow-sm shadow-teal-500/20 border border-teal-400/30',
};

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('kyubi_access_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    fetch('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          localStorage.removeItem('kyubi_access_token');
          router.replace('/login');
          return;
        }
        const data = await res.json();
        const u: AdminUser = data.user ?? data;
        if (!STAFF_ROLES.includes(u.role)) {
          router.replace('/');
          return;
        }
        setUser(u);
      })
      .catch(() => router.replace('/login'))
      .finally(() => setChecked(true));
  }, [router]);

  // Cerrar drawer al cambiar de ruta
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const content = <SidebarContent pathname={pathname} user={user} />;

  return (
    <>
      {/* ── Topbar móvil (< md) con Liquid Glass y Logo ── */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-16 backdrop-blur-xl bg-slate-950/75 border-b border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex items-center justify-between px-4">
        <Link href="/admin" className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-2xl p-1 bg-gradient-to-tr from-violet-600/30 to-fuchsia-600/30 border border-white/15 shadow-md shadow-violet-500/20 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-violet-500/20 blur-sm" />
            <img
              src="/kyubi-logo.png"
              alt="Kyubi"
              className="relative w-6 h-6 object-contain drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                KYUBI
              </span>
              <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300">
                MOD
              </span>
            </div>
          </div>
        </Link>
        <button
          type="button"
          aria-label={drawerOpen ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setDrawerOpen((v) => !v)}
          className="w-10 h-10 flex items-center justify-center rounded-2xl text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors shadow-sm"
        >
          {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* ── Drawer móvil (< md) ── */}
      {drawerOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 backdrop-blur-2xl bg-slate-950/90 border-r border-white/10 shadow-2xl overflow-y-auto flex flex-col">
            {checked ? (
              content
            ) : (
              <div className="h-full flex items-center justify-center">
                <span className="text-slate-500 text-sm animate-pulse">Verificando…</span>
              </div>
            )}
          </aside>
        </>
      )}

      {/* ── Sidebar fijo (md+) con Liquid Glass ── */}
      <aside className="hidden md:flex w-64 min-h-screen backdrop-blur-2xl bg-slate-950/65 border-r border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] flex-col shrink-0 sticky top-0 z-30">
        {checked ? (
          content
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-slate-500 text-sm animate-pulse">Verificando…</span>
          </div>
        )}
      </aside>
    </>
  );
}

function SidebarContent({
  pathname,
  user,
}: {
  pathname: string;
  user: AdminUser | null;
}) {
  return (
    <>
      {/* Header / Logo de Kyubi con efecto resplandor */}
      <div className="px-5 pt-7 pb-6 border-b border-white/[0.06]">
        <Link href="/admin" className="block group">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 rounded-2xl p-1 bg-gradient-to-tr from-violet-600/30 via-purple-600/20 to-fuchsia-600/30 border border-white/15 shadow-lg shadow-violet-500/25 flex items-center justify-center overflow-hidden transition-transform duration-300 group-hover:scale-105">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/25 to-transparent blur-md" />
              <img
                src="/kyubi-logo.png"
                alt="Kyubi"
                className="relative w-7 h-7 object-contain drop-shadow-[0_0_10px_rgba(168,85,247,0.6)]"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  KYUBI
                </p>
                <span className="text-[8px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-300 shadow-sm shadow-violet-500/10">
                  MOD / ADMIN
                </span>
              </div>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Consola Central
              </p>
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation con iconos Lucide y Squircles */}
      <nav className="flex-1 px-3 py-5 space-y-1.5">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-all duration-200 group ${
                active
                  ? 'bg-gradient-to-r from-violet-600/85 via-purple-600/85 to-indigo-600/85 text-white font-semibold shadow-lg shadow-violet-500/25 border border-white/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              <Icon
                className={`w-4 h-4 transition-transform duration-200 group-hover:scale-110 ${
                  active ? 'text-white' : 'text-slate-400 group-hover:text-violet-400'
                }`}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer con Liquid Glass */}
      <div className="p-3.5 space-y-2.5 border-t border-white/[0.06]">
        {/* Status Socket Card */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] backdrop-blur-md px-3.5 py-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-sm shadow-emerald-500/50" />
              </span>
              <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
                ONLINE
              </span>
            </div>
            <Activity className="w-3.5 h-3.5 text-emerald-500/70" />
          </div>
          <p className="mt-1 text-[9px] text-slate-500 font-medium tracking-wide">
            SOCKET CONECTADO
          </p>
        </div>

        {/* User Card */}
        {user && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-md p-2.5 flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-9 h-9 rounded-xl object-cover ring-1 ring-white/20 shadow-sm"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-white font-bold text-xs ring-1 ring-white/20 shadow-sm">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {user.displayName || user.username}
              </p>
              <span
                className={`inline-block mt-0.5 text-[8px] font-extrabold tracking-wider px-2 py-0.5 rounded-full ${
                  ROLE_STYLES[user.role] ?? 'bg-slate-800 text-slate-400'
                }`}
              >
                {user.role}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
