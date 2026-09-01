import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Almacenamiento de objetos de Kyubi.
 *
 * Soporta dos drivers:
 *  - `s3`:   Cliente compatible con S3 (AWS S3, Cloudflare R2 vía `S3_ENDPOINT`).
 *  - `local`: Escritura en disco (`uploads/`) como respaldo de desarrollo/offline.
 *
 * El driver se elige con `STORAGE_DRIVER`; si no se indica, se usa `s3` cuando
 * existen credenciales S3 y `local` en caso contrario (tests / dev sin servicio).
 */

export type StorageDriver = 's3' | 'local';

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

function resolveConfig(): ResolvedConfig {
  const explicit = (process.env.STORAGE_DRIVER || '').toLowerCase();
  const driver: StorageDriver =
    explicit === 's3'
      ? 's3'
      : explicit === 'local'
        ? 'local'
        : isS3Configured()
          ? 's3'
          : 'local';

  return {
    driver,
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
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
  });

  return {
    driver: 's3',
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
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

let cached: StorageEngine | null = null;

/** Devuelve la instancia de almacenamiento activa (memoizada). */
export function getStorage(): StorageEngine {
  if (cached) return cached;
  const cfg = resolveConfig();
  cached = cfg.driver === 's3' ? s3Engine(cfg) : localEngine(cfg);
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