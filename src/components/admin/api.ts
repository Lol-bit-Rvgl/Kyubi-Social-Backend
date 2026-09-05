'use client';

/**
 * Fetch con el token de staff adjunto automáticamente.
 * Lee `kyubi_access_token` de localStorage y añade Authorization: Bearer.
 *
 * Ante un 401:
 *  1. Intenta renovar el accessToken con `kyubi_refresh_token` (POST /auth/refresh).
 *  2. Si la renovación falla, limpia las credenciales y redirige a /login?expired=true.
 */
export async function adminFetch(
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(String(input), init);
  }

  const doFetch = (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(String(input), { ...init, headers });
  };

  let res = await doFetch(localStorage.getItem('kyubi_access_token'));
  if (res.status !== 401) return res;

  // Token expirado: intentar refresh una única vez.
  const refreshed = await _tryRefresh();
  if (refreshed) {
    res = await doFetch(refreshed);
    if (res.status !== 401) return res;
  }

  // Refresh imposible o aún 401: cerrar sesión del panel y redirigir.
  clearAdminTokens();
  window.location.href = '/login?expired=true';
  // Retornar la respuesta para no romper la promesa del llamador; el
  // redirect ocurre de inmediato y la vista se desmonta.
  return res;
}

async function _tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('kyubi_refresh_token');
  if (!refreshToken) return null;
  try {
    const res = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.accessToken) return null;
    localStorage.setItem('kyubi_access_token', data.accessToken);
    if (data.refreshToken) {
      localStorage.setItem('kyubi_refresh_token', data.refreshToken);
    }
    return data.accessToken as string;
  } catch {
    return null;
  }
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('kyubi_access_token');
}

export function clearAdminTokens() {
  localStorage.removeItem('kyubi_access_token');
  localStorage.removeItem('kyubi_refresh_token');
}
