import { createHash } from 'crypto';

/** Tope de descargas para comparar hash antes de decidir que hay que subir. */
export const MAX_MEDIA_HASH_LOOKUPS = 6;

export function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Nombre de archivo que WordPress acepta en Content-Disposition. */
export function sanitizeWpMediaFileName(fileName: string, mimeType: string): string {
  const base = String(fileName || 'image')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  const hasExt = /\.(jpe?g|png|gif|webp|bmp)$/i.test(base);
  if (hasExt) return base || 'image.jpg';
  const ext = mimeType?.includes('png')
    ? 'png'
    : mimeType?.includes('webp')
      ? 'webp'
      : mimeType?.includes('gif')
        ? 'gif'
        : 'jpg';
  return `${base || 'image'}.${ext}`;
}

/**
 * Clave de nombre: minúsculas, sin ruta, y sin el sufijo -2 que WordPress
 * añade al duplicar (foto-2.jpg ≡ foto.jpg).
 */
export function mediaNameKey(fileName: string): string {
  const base = decodeURIComponent(String(fileName || '').split('?')[0])
    .split(/[/\\]/)
    .pop() || '';
  const normalized = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return normalized.replace(/-\d+(?=\.[a-z0-9]+$)/i, '');
}

export type WpMediaCandidate = {
  id: number;
  sourceUrl?: string;
  file?: string;
  filesize?: number;
  parent?: number;
};

export function candidateFileName(candidate: WpMediaCandidate): string {
  return candidate.file || candidate.sourceUrl || '';
}

/**
 * Elige un adjunto ya existente.
 * Mismo hash gana. Si no hay hash, mismo nombre (y tamaño compatible) reutiliza el id.
 * Un mismo nombre con hash distinto no se reutiliza.
 */
export function pickReusableMediaId(
  candidates: readonly WpMediaCandidate[],
  args: {
    fileName: string;
    byteLength: number;
    contentHash: string;
    hashes?: ReadonlyMap<number, string>;
    postId?: number;
  },
): number | null {
  const wantName = mediaNameKey(args.fileName);
  const ranked = [...candidates].sort((a, b) => {
    const aAttached = args.postId && a.parent === args.postId ? 0 : 1;
    const bAttached = args.postId && b.parent === args.postId ? 0 : 1;
    if (aAttached !== bAttached) return aAttached - bAttached;
    return a.id - b.id;
  });

  for (const candidate of ranked) {
    const hash = args.hashes?.get(candidate.id);
    if (hash && hash === args.contentHash) return candidate.id;
  }

  if (!wantName) return null;

  for (const candidate of ranked) {
    if (mediaNameKey(candidateFileName(candidate)) !== wantName) continue;
    if (
      candidate.filesize != null &&
      candidate.filesize !== args.byteLength
    ) {
      continue;
    }
    const hash = args.hashes?.get(candidate.id);
    if (hash && hash !== args.contentHash) continue;
    return candidate.id;
  }

  return null;
}
