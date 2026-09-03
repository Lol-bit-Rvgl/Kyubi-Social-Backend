import { randomUUID } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { getStorage } from '@/lib/storage';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

/** Límite de tamaño (bytes) por tipo de subida. */
export const KIND_MAX_BYTES: Record<string, number> = {
  avatar: 5 * 1024 * 1024,
  banner: 5 * 1024 * 1024,
  media: 50 * 1024 * 1024,
  post: 50 * 1024 * 1024,
  attachment: 50 * 1024 * 1024,
};

export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Whitelist estricta de MIME aceptados. */
export const ALLOWED_UPLOAD_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/quicktime',
]);

/** Mapea extensiones a MIME (fallback cuando el cliente no envía content-type). */
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Resuelve el MIME de un archivo: prefiere `file.type` (content-type enviado por
 * el cliente) y, si está vacío, lo infiere de la extensión del `filename`.
 *
 * Esto es esencial para que subir imágenes desde móviles que no envían
 * `Content-Type` del multipart parte (p.ej. avatar/banner/story) no sea
 * rechazado por la whitelist.
 */
export function resolveMime(file: File): string {
  const fromType = (file.type || '').toLowerCase();
  if (fromType && ALLOWED_UPLOAD_MIMES.has(fromType)) return fromType;
  const ext = path.extname(file.name || '').toLowerCase();
  return EXT_MIME[ext] ?? fromType;
}

/**
 * Valida que un archivo cumpla la whitelist de MIME y el tope de tamaño de su
 * `kind`. Devuelve un mensaje de error o `null` si es válido.
 */
export function validateUpload(file: File, kind: string): string | null {
  const mime = resolveMime(file);
  if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
    return 'Tipo de archivo no permitido';
  }
  const max = KIND_MAX_BYTES[(kind || '').toLowerCase()] ?? DEFAULT_MAX_BYTES;
  if (file.size > max) {
    return `El archivo supera el tamaño máximo permitido (${Math.round(max / 1024 / 1024)} MB)`;
  }
  return null;
}

/** MIME que se pueden optimizar con `sharp` (se convierten a WebP). */
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/tiff',
]);

function extFor(file: File): string {
  const fromMime = EXT_BY_MIME[file.type];
  if (fromMime) return fromMime;
  const original = path.extname(file.name || '').toLowerCase();
  return original && original.length <= 5 ? original : '';
}

/** Carpeta lógica según el tipo de subida para keys ordenadas en el bucket. */
export function folderFor(kind: string): string {
  const k = (kind || '').toLowerCase();
  switch (k) {
    case 'avatar':
      return 'avatars';
    case 'banner':
      return 'banners';
    case 'media':
      return 'media';
    case 'post':
    case 'attachment':
      return 'posts';
    default:
      return 'misc';
  }
}

type OptimizedImage = { body: Buffer; contentType: string; ext: string };

/**
 * Comprime/redimensiona imágenes con `sharp` para optimizar el ancho de banda
 * móvil. Las imágenes se normalizan a WebP (excepto GIF, para no romper la
 * animación). Devuelve el buffer optimizado + su content-type y extensión.
 */
async function optimizeImage(
  bytes: Buffer,
  mime: string,
): Promise<OptimizedImage> {
  if (mime === 'image/gif') {
    return { body: bytes, contentType: mime, ext: '.gif' };
  }

  const maxWidth = Number(process.env.IMAGE_MAX_WIDTH || 1600);
  const quality = Number(process.env.IMAGE_QUALITY || 82);

  const body = await sharp(bytes)
    .rotate() // respeta orientación EXIF
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer();

  return { body, contentType: 'image/webp', ext: '.webp' };
}

/**
 * Guarda un archivo y devuelve la URL pública remota (o local en modo dev).
 *
 * Las imágenes (excepto GIF) se optimizan con `sharp` a WebP. El destino final
 * lo decide `STORAGE_DRIVER`: S3-compatible (AWS/R2) o disco `uploads/`.
 */
export async function saveUpload(file: File, kind = 'misc'): Promise<string> {
  const validationError = validateUpload(file, kind);
  if (validationError) throw new Error(`UPLOAD_REJECTED:${validationError}`);

  const storage = getStorage();
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = resolveMime(file);

  let body: Uint8Array = bytes;
  let contentType = mime || 'application/octet-stream';
  let ext = extFor(file);

  if (IMAGE_MIMES.has(mime)) {
    const optimized = await optimizeImage(bytes, mime);
    body = optimized.body;
    contentType = optimized.contentType;
    ext = optimized.ext;
  }

  const key = `${folderFor(kind)}/${randomUUID()}${ext}`;
  await storage.put(key, body, contentType);
  return storage.publicUrl(key);
}

/** Versión en lote de [saveUpload]. */
export async function saveUploads(
  files: File[],
  kind = 'misc',
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    urls.push(await saveUpload(file, kind));
  }
  return urls;
}
