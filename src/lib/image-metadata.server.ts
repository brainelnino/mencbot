import * as ExifReader from 'exifreader';
import type { TgUpdate } from './telegram-parse';
import { botCall } from './office.server';
import { metadataNotice } from './tenant-format';

const MAX_BYTES = 5 * 1024 * 1024;
export async function inspectImageMetadata(token: string, update: TgUpdate): Promise<string | null> {
  const message = update.message;
  const document = message?.document as { file_id?: string; file_size?: number; mime_type?: string } | undefined;
  const photos = message?.photo as Array<{ file_id?: string; file_size?: number; width?: number; height?: number }> | undefined;
  const photo = photos?.slice().sort((a,b) => (b.width ?? 0)*(b.height ?? 0)-(a.width ?? 0)*(a.height ?? 0))[0];
  const file = document?.mime_type?.match(/^image\/(jpeg|png|webp|tiff)$/) ? document : photo;
  if (!file?.file_id || (file.file_size ?? 0) > MAX_BYTES) return null;
  try {
    const info = await botCall<{ file_path?: string; file_size?: number }>(token, 'getFile', { file_id: file.file_id });
    if (!info.file_path || !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(info.file_path) || info.file_path.includes('..') || (info.file_size ?? 0) > MAX_BYTES) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const tags = ExifReader.load(bytes.buffer);
    const safe: Record<string,string> = {};
    for (const key of ['Software','CreatorTool','DigitalSourceType','DateTimeOriginal','CreateDate']) {
      const description = tags[key]?.description;
      if (typeof description === 'string') safe[key] = description;
    }
    return metadataNotice(safe);
  } catch { return null; }
}