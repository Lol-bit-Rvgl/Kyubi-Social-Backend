import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

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

function extFor(file: File): string {
  const fromMime = EXT_BY_MIME[file.type];
  if (fromMime) return fromMime;
  const original = path.extname(file.name || '').toLowerCase();
  return original && original.length <= 5 ? original : '';
}

export async function saveUpload(file: File): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = `${randomUUID()}${extFor(file)}`;
  await writeFile(path.join(UPLOAD_DIR, name), bytes);
  return name;
}

export async function saveUploads(files: File[]): Promise<string[]> {
  const names: string[] = [];
  for (const file of files) {
    names.push(await saveUpload(file));
  }
  return names;
}

export function uploadUrl(request: Request, name: string): string {
  const { protocol, host } = new URL(request.url);
  return `${protocol}//${host}/uploads/${name}`;
}
