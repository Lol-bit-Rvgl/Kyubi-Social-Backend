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

/**
 * URL externa o ruta de recurso seguro para campos multimedia (imágenes, stickers, audio).
 * - Permite URLs HTTP y HTTPS válidas.
 * - Permite rutas locales de assets (ej: `assets/stickers/...`).
 * - Rechaza esquemas peligrosos como `javascript:`, `data:`, `vbscript:`, `file:`.
 */
export const safeMediaUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (val) => {
      const lower = val.toLowerCase();
      if (
        lower.startsWith('javascript:') ||
        lower.startsWith('data:') ||
        lower.startsWith('vbscript:') ||
        lower.startsWith('file:')
      ) {
        return false;
      }
      return true;
    },
    { message: 'URL o ruta de medio no válida' },
  );

/** Versión nullable/opcional lista para usar en schemas de payloads con multimedia. */
export const optionalSafeMediaUrl = safeMediaUrl.nullable().optional();

