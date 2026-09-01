import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Una PNG válida de 1x1 (minimal) para que `sharp` pueda decodificarla.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// Mock del cliente S3 para validar el driver remoto sin red.
const s3Mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue({}),
  lastCommand: undefined as
    | { Bucket?: string; Key?: string; ContentType?: string }
    | undefined,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = s3Mocks.send;
  },
  PutObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
      s3Mocks.lastCommand = input as never;
    }
  },
}));

import { resetStorageForTests } from '@/lib/storage';
import { folderFor, saveUpload, saveUploads } from '@/lib/upload';

function pngFile(type = 'image/png', name = 'photo.png'): File {
  // `File` está disponible globalmente en Node >= 20.
  return new File([TINY_PNG], name, { type });
}

describe('subidas a la nube (S3-compatible)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'kyubi-media';
    process.env.S3_REGION = 'auto';
    process.env.S3_ACCESS_KEY = 'test-access-key';
    process.env.S3_SECRET_KEY = 'test-secret-key';
    process.env.S3_PUBLIC_URL = 'https://media.example.dev';
    process.env.IMAGE_MAX_WIDTH = '640';
    process.env.IMAGE_QUALITY = '70';
    resetStorageForTests();
  });

  it('saveUpload devuelve una URL pública remota de S3', async () => {
    const url = await saveUpload(pngFile(), 'avatar');

    expect(url).toMatch(/^https:\/\/media\.example\.dev\/avatars\/.+\.webp$/);
    // La imagen se reencodifica a WebP por sharp.
    expect(url.endsWith('.webp')).toBe(true);

    const command = s3Mocks.lastCommand;
    expect(command).toBeDefined();
    expect(command!.Bucket).toBe('kyubi-media');
    expect(command!.Key).toMatch(/^avatars\/.+\.webp$/);
    expect(command!.ContentType).toBe('image/webp');
  });

  it('envía varios archivos con saveUploads (media)', async () => {
    const urls = await saveUploads([pngFile(), pngFile()], 'media');

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/media\.example\.dev\/media\/.+\.webp$/);
    }
    expect(s3Mocks.send).toHaveBeenCalledTimes(2);
  });
});

describe('subidas en modo local (respaldo dev)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kyubi-upload-'));
    process.env.STORAGE_DRIVER = 'local';
    process.env.UPLOAD_DIR = dir;
    process.env.APP_URL = 'https://app.example.dev';
    resetStorageForTests();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('escribe en disco y devuelve la URL pública correspondiente', async () => {
    const url = await saveUpload(pngFile(), 'banner');

    expect(url).toMatch(/^https:\/\/app\.example\.dev\/uploads\/banners\/.+\.webp$/);

    const filePath = path.join(dir, 'banners', url.split('/').pop()!);
    const bytes = await readFile(filePath);
    // El archivo en disco es WebP optimizado (no la PNG original).
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe('carpeta lógica por tipo', () => {
  it('mapea avatar, banner, media y desconocido', () => {
    expect(folderFor('avatar')).toBe('avatars');
    expect(folderFor('banner')).toBe('banners');
    expect(folderFor('media')).toBe('media');
    expect(folderFor('post')).toBe('posts');
    expect(folderFor('video')).toBe('misc');
  });
});