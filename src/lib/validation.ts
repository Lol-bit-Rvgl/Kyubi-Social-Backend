import { z } from 'zod';

/**
 * URL externa "segura" para campos de contenido (media, avatares, enlaces).
 *
 * - Debe ser una URL válida parseable por `URL`.
 * - Solo se aceptan esquemas `http:` y `https:`.
 * - Rechaza `javascript:`, `data:`, `vbscript:`, `file:`, etc., que podrían
 *   terminar renderizadas en clientes y ejecutar payloads (XSS / smuggling).
 */
export const safeHttpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (url) => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Solo se permiten URLs HTTP o HTTPS seguras' },
  );

/** Versión nullable/opcional lista para usar en schemas de payloads. */
export const optionalSafeHttpUrl = safeHttpUrl.nullable().optional();
