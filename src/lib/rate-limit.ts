import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate-limiting con arquitectura dual (pluggable):
 *
 *  - Upstash Redis (Sliding Window): se activa automáticamente cuando existen
 *    `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Funciona con
 *    múltiples instancias/réplicas y sobrevive a redeploys.
 *  - Memoria (Map con limpieza): fallback automático en tests
 *    (`NODE_ENV === 'test'`) o cuando no hay credenciales de Redis.
 *
 * Ambos backends exponen la misma interfaz:
 *   checkRateLimit(key, limit, windowSec) -> { success, remaining, reset }
 */

export type RateLimitResult = {
  success: boolean;
  /** Llamadas que aún puede hacer dentro de la ventana. */
  remaining: number;
  /** Epoch (ms) en que se resetea la ventana. */
  reset: number;
};

export interface RateLimiterBackend {
  checkRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
}

// ── Backend en memoria (fallback / tests) ─────────────────────────────────────

class MemoryRateLimiter implements RateLimiterBackend {
  private hits = new Map<string, { count: number; resetAt: number }>();

  async checkRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSec * 1000;
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      // Limpieza oportunista: solo cuando el mapa crece demasiado.
      if (this.hits.size > 10_000) {
        for (const [k, v] of this.hits) {
          if (v.resetAt <= now) this.hits.delete(k);
        }
      }
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return { success: true, remaining: limit - 1, reset: now + windowMs };
    }

    entry.count += 1;
    return {
      success: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      reset: entry.resetAt,
    };
  }
}

// ── Backend Upstash Redis (Sliding Window, serverless-friendly) ──────────────

class UpstashRateLimiter implements RateLimiterBackend {
  private redis: Redis;
  /** Cache de limiters por firma `${limit}:${windowSec}` (evita recrearlos). */
  private limiters = new Map<string, Ratelimit>();

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async checkRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const signature = `${limit}:${windowSec}`;
    let limiter = this.limiters.get(signature);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
        prefix: `kyubi:rl:${signature}`,
        analytics: false,
      });
      this.limiters.set(signature, limiter);
    }
    const r = await limiter.limit(key);
    return { success: r.success, remaining: r.remaining, reset: r.reset };
  }
}

// ── Selección de backend ──────────────────────────────────────────────────────

let backend: RateLimiterBackend | null = null;

export function getRateLimitBackend(): RateLimiterBackend {
  if (backend) return backend;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token && process.env.NODE_ENV !== 'test') {
    backend = new UpstashRateLimiter(url, token);
  } else {
    backend = new MemoryRateLimiter();
  }
  return backend;
}

/** Solo para tests: resetea el backend seleccionado. */
export function resetRateLimitBackend() {
  backend = null;
}

/**
 * Crea un limitador para una ruta. Devuelve `true` si la petición pasa.
 * Nota: la función es async (con Upstash hace round-trip a Redis); los
 * call-sites deben hacer `await limiter(key)`.
 *
 * Cada limitador genera un namespace propio para su key: aunque los backends
 * (Map de memoria o Redis) sean compartidos entre rutas, dos límites distintos
 * nunca se contaminan entre sí aunque la key base coincida (p. ej. la IP).
 */
let limiterSeq = 0;
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const limiter = getRateLimitBackend();
  const namespace = `l${++limiterSeq}`;
  return (key: string): Promise<boolean> =>
    limiter.checkRateLimit(`${namespace}:${key}`, max, windowSec).then((r) => r.success);
}
