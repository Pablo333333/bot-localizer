/**
 * Helpers de URLs / buffers de Google Drive (sin cliente API).
 * Usados para descargar adjuntos de anuncio y validar que son imágenes reales.
 */

const FILE_ID_PATTERNS = [
  /\/file\/d\/([a-zA-Z0-9_-]+)/,
  /\/thumbnail\?[^#]*[?&]id=([a-zA-Z0-9_-]+)/i,
  /[?&]id=([a-zA-Z0-9_-]+)/,
  /\/d\/([a-zA-Z0-9_-]+)/,
  /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
];

/** `?resourcekey=` de un enlace de carpeta o archivo compartido por link. */
export function extractDriveResourceKey(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const match = String(raw).match(/[?&]resourcekey=([^&#\s]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Cabecera que Drive exige para abrir un archivo solo con el enlace. */
export function driveResourceKeyHeader(
  fileId?: string | null,
  resourceKey?: string | null,
): { headers?: Record<string, string> } {
  const id = String(fileId || '').trim();
  const key = String(resourceKey || '').trim();
  if (!id || !key) return {};
  return {
    headers: { 'X-Goog-Drive-Resource-Keys': `${id}/${key}` },
  };
}

export function extractDriveFileIdFromUrl(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/\/(?:drive\/)?folders\//i.test(trimmed)) {
    return null;
  }

  for (const re of FILE_ID_PATTERNS) {
    const m = trimmed.match(re);
    if (m?.[1]) return m[1];
  }

  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function isLikelyHtmlBuffer(buffer: Buffer): boolean {
  if (!buffer?.length) return false;
  const head = buffer.subarray(0, 256).toString('utf8').trim().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<title>google drive') ||
    head.includes('uc-error') ||
    head.includes('virus scan warning')
  );
}

export function inferImageMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 3) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
}

export function normalizeImageMimeType(mimeType?: string | null): string {
  const raw = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (raw === 'image/jpg' || raw === 'image/pjpeg') return 'image/jpeg';
  if (raw.startsWith('image/')) return raw;
  return 'image/jpeg';
}

export function parseDriveConfirmFromHtml(html: string): {
  confirm: string;
  uuid?: string;
} | null {
  if (!html) return null;
  const confirm =
    html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1] ||
    html.match(/name=["']confirm["']\s+value=["']([^"']+)["']/i)?.[1] ||
    html.match(/name=["']confirm["'][^>]*value=["']([^"']+)["']/i)?.[1];
  const uuid =
    html.match(/name=["']uuid["']\s+value=["']([^"']+)["']/i)?.[1] ||
    html.match(/[?&]uuid=([0-9A-Za-z_-]+)/)?.[1];
  if (!confirm && !html.toLowerCase().includes('virus scan')) {
    return null;
  }
  return { confirm: confirm || 't', uuid };
}

function bufferFromUnknown(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') return Buffer.from(data, 'binary');
  return Buffer.from(data as ArrayBuffer);
}

export async function downloadPublicDriveFile(
  fileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const primary = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const first = await fetchImpl(primary, { redirect: 'follow' });
  if (!first.ok && first.status !== 200) {
    throw new Error(
      `Descarga pública Drive HTTP ${first.status} fileId=${fileId}`,
    );
  }

  const contentType = (first.headers.get('content-type') || '').toLowerCase();
  const firstBuf = bufferFromUnknown(await first.arrayBuffer());

  if (!contentType.includes('text/html') && !isLikelyHtmlBuffer(firstBuf)) {
    return firstBuf;
  }

  const html = firstBuf.toString('utf8');
  const parsed = parseDriveConfirmFromHtml(html);
  const confirm = parsed?.confirm || 't';
  const uuidQs = parsed?.uuid ? `&uuid=${encodeURIComponent(parsed.uuid)}` : '';
  const confirmed = `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(confirm)}&id=${encodeURIComponent(fileId)}${uuidQs}`;
  const second = await fetchImpl(confirmed, { redirect: 'follow' });
  if (!second.ok) {
    throw new Error(
      `Descarga pública Drive (confirm) HTTP ${second.status} fileId=${fileId}`,
    );
  }
  return bufferFromUnknown(await second.arrayBuffer());
}

export function assertImageBuffer(buffer: Buffer, fileId: string): string {
  if (!buffer?.length) {
    throw new Error(`Buffer vacío para fileId=${fileId}`);
  }
  if (isLikelyHtmlBuffer(buffer)) {
    throw new Error(
      `Drive devolvió HTML en lugar de imagen (¿permiso o virus-scan?) fileId=${fileId}`,
    );
  }
  const mime = inferImageMimeType(buffer);
  if (!mime) {
    throw new Error(
      `El archivo Drive no parece una imagen (magic bytes) fileId=${fileId}`,
    );
  }
  return mime;
}
