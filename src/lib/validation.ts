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
  .url()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL inválida o con esquema no permitido' },
  );

/** Versión nullable/opcional lista para usar en schemas de payloads. */
export const optionalSafeHttpUrl = safeHttpUrl.nullable().optional();
