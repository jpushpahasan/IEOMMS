// Document file storage.
// - Vercel Blob (private store) when a store is connected: BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is set.
// - otherwise the local folder data/uploads.
// Files are only ever served through the permission-checked /api/documents/:id/file route.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config.ts';

export const storageKind = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? 'vercel-blob' : 'local';
const PREFIX = 'documents/';

export async function putFile(name: string, data: Buffer, contentType: string) {
  if (storageKind === 'vercel-blob') {
    const { put } = await import('@vercel/blob');
    await put(PREFIX + name, data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
    return;
  }
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, name), data, { flag: 'wx' });
}

/** A readable stream of the file, or null when it is missing. */
export async function openFile(name: string): Promise<Readable | null> {
  if (storageKind === 'vercel-blob') {
    const { get } = await import('@vercel/blob');
    const r = await get(PREFIX + name, { access: 'private' });
    return r?.statusCode === 200 ? Readable.fromWeb(r.stream as any) : null;
  }
  const file = path.join(config.uploadDir, name);
  return fs.existsSync(file) ? fs.createReadStream(file) : null;
}

export async function deleteFile(name: string) {
  if (storageKind === 'vercel-blob') {
    const { del } = await import('@vercel/blob');
    await del(PREFIX + name);
    return;
  }
  fs.rmSync(path.join(config.uploadDir, name), { force: true });
}
