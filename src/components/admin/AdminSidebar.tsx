'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '📊', exact: true },
  { href: '/admin/reports', label: 'Reportes', icon: '🚨' },
  { href: '/admin/users', label: 'Usuarios', icon: '👥' },
  { href: '/admin/posts', label: 'Publicaciones', icon: '📝' },
  { href: '/admin/audit-logs', label: 'Audit Logs', icon: '📜' },
];

const STAFF_ROLES = ['MODERATOR', 'ADMIN', 'OWNER'];

interface AdminUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: string;
}

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-red-600',
  ADMIN: 'bg-violet-600',
  MODERATOR: 'bg-teal-600',
};

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);

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

  if (!checked) {
    return (
      <aside className="w-64 min-h-screen bg-black border-r border-neutral-900 flex items-center justify-center">
        <span className="text-neutral-600 text-sm animate-pulse">Verificando…</span>
      </aside>
    );
  }

  return (
    <aside className="w-64 min-h-screen bg-black border-r border-neutral-900 flex flex-col shrink-0">
      {/* Header / Logo */}
      <div className="px-6 pt-8 pb-6">
        <Link href="/admin" className="block">
          <p className="text-2xl font-black tracking-tight text-white">KYUBI</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-500">
            Moderation Console
          </p>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all ${
                active
                  ? 'bg-violet-600 text-white font-semibold shadow-lg shadow-violet-950/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 space-y-3">
        {/* Estado del sistema */}
        <div className="rounded-xl bg-neutral-950 border border-neutral-900 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-green-400" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-[10px] font-bold tracking-widest text-green-400 uppercase">
              ONLINE
            </span>
          </div>
          <p className="mt-1 text-[10px] text-neutral-500 font-medium tracking-wide">
            SOCKET CONNECTED
          </p>
        </div>

        {/* Tarjeta de usuario */}
        {user && (
          <div className="rounded-xl bg-neutral-950 border border-neutral-900 p-3 flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-9 h-9 rounded-full object-cover ring-2 ring-neutral-800"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-white font-bold ring-2 ring-neutral-800">
                {user.username[0]?.toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {user.displayName || user.username}
              </p>
              <span
                className={`inline-block mt-0.5 text-[9px] font-bold tracking-widest text-white px-1.5 py-0.5 rounded ${
                  ROLE_COLORS[user.role] ?? 'bg-neutral-700'
                }`}
              >
                {user.role}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
