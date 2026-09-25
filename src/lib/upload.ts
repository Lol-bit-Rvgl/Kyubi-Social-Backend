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
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

/** Límite de tamaño (bytes) por tipo de subida. */
export const KIND_MAX_BYTES: Record<string, number> = {
  avatar: 5 * 1024 * 1024,
  banner: 5 * 1024 * 1024,
  sticker: 10 * 1024 * 1024,
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
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
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
  '.aac': 'audio/aac',
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

// ── Magic bytes (sniffing real del contenido) ──────────────────────────────
// La extensión del filename y el `Content-Type` del cliente son controlados
// por el usuario. Para audio/vídeo (que NO pasa por `sharp`, que ya actúa de
// validación de facto en imágenes) verificamos las firmas binarias reales del
// buffer antes de persistir en storage.

const AV_MIME_DESCRIPTIONS: Record<string, string> = {
  'audio/mp4': 'MP4/M4A',
  'audio/m4a': 'MP4/M4A',
  'audio/x-m4a': 'MP4/M4A',
  'audio/aac': 'AAC',
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/ogg': 'OGG',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
};

/**
 * Intenta determinar el MIME real de un buffer a partir de sus magic bytes.
 * Devuelve `null` si no reconoce la firma.
 */
export function sniffMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // MP4/MOV/M4A: bytes 4..7 == 'ftyp' (ISO BMFF). La marca en 8..11 distingue
  // brand: 'qt  ' → QuickTime MOV; m4a/m4b → audio/mp4; el resto → mp4.
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12).toLowerCase();
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return 'audio/mp4';
    return 'video/mp4';
  }
  // AAC ADTS: 0xFFF (12 bits syncword: byte 0 is 0xFF, byte 1 top 4 bits are 0xF)
  if (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) return 'audio/aac';
  // MP3: cabecera ID3 o frame MPEG sync (0xFF Ex/Fx).
  if (bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  // OGG: 'OggS'.
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  // WAV: 'RIFF' + 'WAVE' en offset 8.
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  return null;
}

/**
 * Verifica que el contenido de un archivo de audio/vídeo coincida con el MIME
 * declarado/inferido. Devuelve un mensaje de error o `null` si es válido.
 */
export function validateMediaContent(bytes: Buffer, mime: string): string | null {
  if (!AV_MIME_DESCRIPTIONS[mime]) return null; // solo audio/vídeo
  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    return `El contenido no parece un archivo ${AV_MIME_DESCRIPTIONS[mime]} válido`;
  }
  // Tolerancia razonable: mp4, mov y m4a comparten contenedor ISO BMFF; un .mp4
  // real se acepta como quicktime / audio/mp4 / audio/m4a y viceversa.
  const isIsoBmff = (m: string) =>
    m === 'video/mp4' ||
    m === 'video/quicktime' ||
    m === 'audio/mp4' ||
    m === 'audio/m4a' ||
    m === 'audio/x-m4a';

  const isAudioMpeg = (m: string) => m === 'audio/mpeg' || m === 'audio/mp3';
  const isAudioWav = (m: string) => m === 'audio/wav' || m === 'audio/x-wav';

  const compatible =
    sniffed === mime ||
    (isIsoBmff(sniffed) && isIsoBmff(mime)) ||
    (isAudioMpeg(sniffed) && isAudioMpeg(mime)) ||
    (isAudioWav(sniffed) && isAudioWav(mime));
  if (!compatible) {
    return `El contenido del archivo no coincide con el tipo ${AV_MIME_DESCRIPTIONS[mime]}`;
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
    case 'sticker':
      return 'stickers';
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
 *
 * Para stickers y WebP animados se usa `{ animated: true }` y calidad 90 para
 * no descartar los fotogramas de animación ni degradar la calidad.
 */
async function optimizeImage(
  bytes: Buffer,
  mime: string,
  kind = 'misc',
): Promise<OptimizedImage> {
  if (mime === 'image/gif') {
    return { body: bytes, contentType: mime, ext: '.gif' };
  }

  const isAvatar = kind.toLowerCase() === 'avatar';
  const isSticker = kind.toLowerCase() === 'sticker';
  const maxWidth = isAvatar || isSticker ? 512 : Number(process.env.IMAGE_MAX_WIDTH || 1600);
  const quality = isSticker ? 90 : Number(process.env.IMAGE_QUALITY || 82);

  // Preserve all animation frames for animated WebP / PNG / images with { animated: true }
  const transformer = sharp(bytes, { animated: true }).rotate();
  if (isAvatar) {
    transformer.resize({
      width: 512,
      height: 512,
      fit: 'cover',
      withoutEnlargement: true,
    });
  } else if (isSticker) {
    transformer.resize({
      width: 512,
      height: 512,
      fit: 'inside',
      withoutEnlargement: true,
    });
  } else {
    transformer.resize({ width: maxWidth, withoutEnlargement: true });
  }

  const body = await transformer
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

  // Anti-bypass: verificar magic bytes reales en audio/vídeo. Un atacante
  // puede renombrar un payload (p. ej. .html → .mp3); si el contenido no
  // coincide con la firma binaria esperada, se rechaza.
  const contentError = validateMediaContent(bytes, mime);
  if (contentError) throw new Error(`UPLOAD_REJECTED:${contentError}`);

  let body: Uint8Array = bytes;
  let contentType = mime || 'application/octet-stream';
  let ext = extFor(file);

  if (IMAGE_MIMES.has(mime)) {
    const optimized = await optimizeImage(bytes, mime, kind);
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
