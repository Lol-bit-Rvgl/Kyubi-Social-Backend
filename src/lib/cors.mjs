/**
 * Módulo centralizado de CORS — única fuente de verdad.
 *
 * Lo consumen:
 *  - `server.mjs` (HTTP real del custom server + handshake de Socket.IO).
 *
 * Reglas:
 *  - Producción: SOLO los orígenes de `CORS_ORIGINS` (sin comodín `*`).
 *  - Desarrollo: `CORS_ORIGINS` + orígenes locales estándar.
 *  - Peticiones sin cabecera `Origin` (curl, same-origin, móvil) se permiten:
 *    CORS solo regula el acceso entre orígenes del navegador.
 */

export const LOCAL_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:8080',
];

/** Lista unificada de orígenes permitidos a partir del entorno. */
export function resolveAllowedOrigins(env = process.env) {
  const configured = (env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isDev = env.NODE_ENV !== 'production';
  return Array.from(new Set([...(isDev ? LOCAL_ORIGINS : []), ...configured]));
}

/**
 * Helper de validación de origen compartido entre HTTP y Socket.IO.
 * `allowedOrigins` debe venir de `resolveAllowedOrigins()`.
 */
export function originIsAllowed(origin, allowedOrigins) {
  if (!origin) return true; // peticiones no-CORS (mismo servidor, curl, apps nativas)
  return allowedOrigins.includes(origin);
}