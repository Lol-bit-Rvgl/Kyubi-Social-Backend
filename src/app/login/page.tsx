'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get('expired') === 'true';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Credenciales inválidas');
      const role = data.user?.role;
      if (!['MODERATOR', 'ADMIN', 'OWNER'].includes(role)) {
        throw new Error('Esta cuenta no tiene acceso al panel de moderación');
      }
      localStorage.setItem('kyubi_access_token', data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem('kyubi_refresh_token', data.refreshToken);
      }
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-3xl font-black tracking-tight text-white">KYUBI</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-500">
            Moderation Console
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-neutral-950 border border-neutral-900 rounded-2xl p-6 space-y-4 shadow-2xl"
        >
          <h1 className="text-lg font-bold text-white">Acceso del staff</h1>

          {expired && (
            <div className="p-3 bg-amber-950/40 border border-amber-900 rounded-lg text-sm text-amber-400">
              Tu sesión ha expirado. Inicia sesión de nuevo.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-900 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${
              loading
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-500 text-white'
            }`}
          >
            {loading ? 'Entrando…' : 'Entrar al panel'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
