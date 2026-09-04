import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Almacenamiento de objetos de Kyubi.
 *
 * Soporta tres drivers:
 *  - `supabase`: Supabase Storage vía @supabase/supabase-js (recomendado).
 *  - `s3`:       Cliente compatible con S3 (AWS S3, Cloudflare R2 vía `S3_ENDPOINT`).
 *  - `local`:    Escritura en disco (`uploads/`) como respaldo de desarrollo/offline.
 *
 * El driver se elige con `STORAGE_DRIVER`; si no se indica, se usa `supabase`
 * cuando existen credenciales Supabase, luego `s3` si hay credenciales S3 y
 * `local` en caso contrario (tests / dev sin servicio).
 */

export type StorageDriver = 'supabase' | 's3' | 'local';

export interface StorageEngine {
  readonly driver: StorageDriver;
  /** Sube/guarda el objeto y devuelve su key lógica (ruta dentro del bucket). */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Genera la URL pública y segura del objeto. */
  publicUrl(key: string): string;
}

interface ResolvedConfig {
  driver: StorageDriver;
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  publicBase: string;
}

function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY,
  );
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function resolveConfig(): ResolvedConfig {
  const explicit = (process.env.STORAGE_DRIVER || '').toLowerCase();
  const driver: StorageDriver =
    explicit === 'supabase'
      ? 'supabase'
      : explicit === 's3'
        ? 's3'
        : explicit === 'local'
          ? 'local'
          : isSupabaseConfigured()
            ? 'supabase'
            : isS3Configured()
              ? 's3'
              : 'local';

  return {
    driver,
    bucket: process.env.S3_BUCKET || '',
    // IMPORTANTE: para Supabase Storage hospedado el `S3_REGION` debe ser la
    // región del proyecto (ej. us-west-2). `auto` es una convención de R2 y
    // NO es válida para firmar (causa SignatureDoesNotMatch 403).
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    // `forcePathStyle` debe ser true estricto para Supabase/MinIO/R2 (bucket en
    // el path, no como subdominio). Default true salvo que se deshabilite con 'false'.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    // La base pública depende del driver: S3_PUBLIC_URL sólo aplica a S3/R2;
    // en modo local se usa APP_URL (dominio que sirve public/uploads).
    publicBase:
      driver === 's3'
        ? (process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')
        : (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

function s3Engine(cfg: ResolvedConfig): StorageEngine {
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    // Desactivar el cálculo/validación automática de checksum: en Supabase
    // Storage esas cabeceras alteran la firma SigV4 y provocan
    // `SignatureDoesNotMatch` (403).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    driver: 's3',
    async put(key, body, contentType) {
      // Normaliza la key para evitar firmas inválidas en Supabase: sin slash
      // inicial ni bucket repetido (`/uploads/avatars/x` o `avatars/...`).
      let clean = key.replace(/^\/+/, '').replace(/\/+$/, '');
      if (cfg.bucket) {
        clean = clean.replace(new RegExp(`^${cfg.bucket}\/+`, 'i'), '');
      }
      if (!clean) clean = `misc/${randomUUID()}`;
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: clean,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    publicUrl(key) {
      if (cfg.publicBase) return `${cfg.publicBase}/${key}`;
      return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
    },
  };
}

function localEngine(cfg: ResolvedConfig): StorageEngine {
  const dir = process.env.UPLOAD_DIR ||
    path.join(process.cwd(), 'public', 'uploads');

  return {
    driver: 'local',
    async put(key, body) {
      const abs = path.join(dir, key);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, body);
    },
    publicUrl(key) {
      return `${cfg.publicBase}/uploads/${key}`;
    },
  };
}

/**
 * Driver de Supabase Storage usando la API nativa (@supabase/supabase-js).
 *
 * Es la vía más estable para Supabase en producción: evita los problemas de
 * firma SigV4 del gateway S3-compatible (SignatureDoesNotMatch 403).
 *
 * Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_SERVICE_KEY`).
 */
function supabaseEngine(): StorageEngine {
  const url =
    process.env.SUPABASE_URL ||
    `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    '';
  const bucket =
    process.env.SUPABASE_BUCKET || process.env.S3_BUCKET || 'uploads';

  const client: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  return {
    driver: 'supabase',
    async put(keyName, body, contentType) {
      const cleanKey = keyName.replace(/^\/+/, '').replace(/\/+$/, '');
      const uploadPath = cleanKey || `misc/${randomUUID()}`;
      const { error } = await client.storage
        .from(bucket)
        .upload(uploadPath, body, {
          contentType: contentType || 'application/octet-stream',
          upsert: true,
        });
      if (error) {
        console.error('[SUPABASE_STORAGE_ERROR]:', error);
        throw error;
      }
    },
    publicUrl(key) {
      const cleanKey = key.replace(/^\/+/, '').replace(/\/+$/, '');
      const { data } = client.storage.from(bucket).getPublicUrl(cleanKey);
      return data.publicUrl;
    },
  };
}

let cached: StorageEngine | null = null;

/** Devuelve la instancia de almacenamiento activa (memoizada). */
export function getStorage(): StorageEngine {
  if (cached) return cached;
  const cfg = resolveConfig();
  if (cfg.driver === 'local' && process.env.NODE_ENV === 'production') {
    // En hosts con disco efímero (Render, Heroku, etc.) las subidas se pierden
    // tras cada redeploy y las URLs guardadas quedan rotas (404) en la app.
    console.warn(
      '[storage] ADVERTENCIA: STORAGE_DRIVER=local en producción. ' +
        'Las imágenes se guardan en disco efímero y se perderán con cada redeploy. ' +
        'Configura almacenamiento persistente (Supabase Storage): ' +
        'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  if (cfg.driver === 'supabase') cached = supabaseEngine();
  else if (cfg.driver === 's3') cached = s3Engine(cfg);
  else cached = localEngine(cfg);
  return cached;
}

/** Invalida la instancia cacheada (útil en tests al cambiar `STORAGE_DRIVER`). */
export function resetStorageForTests(): void {
  cached = null;
}

/** Re-export del driver activo para logs/diagnóstico. */
export function storageDriver(): StorageDriver {
  return getStorage().driver;
}