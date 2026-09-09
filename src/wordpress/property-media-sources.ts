/** Helpers de fuentes de imagen (sin depender de property-mapper — evita ciclos). */

const IMAGE_URL_KEYS = [
  'url_imagen',
  'imagen_url',
  'imagen_drive',
  'google_drive_url',
  'drive_url',
  'foto_url',
  'url_foto',
  'image_url',
  'urls_imagenes',
  'imagenes_drive',
] as const;

const DRIVE_FOLDER_KEYS = [
  'drive_folder_id',
  'carpeta_drive',
  'drive_folder',
  'google_drive_folder',
  'id_carpeta_drive',
] as const;

/** Máximo de imágenes a subir por inmueble (galería WPResidence). */
export const MAX_PROPERTY_IMAGES = 20;

type CadLike = Record<string, unknown> | undefined;

function sanitizeRaw(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  const lower = s.toLowerCase();
  if (
    lower === 'no especificado' ||
    lower === 'unknown' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === ''
  ) {
    return '';
  }
  return s;
}

export function extractDriveFolderId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Preferir patrón de carpeta explícito
  const folderMatch = trimmed.match(/\/(?:drive\/)?folders\/([a-zA-Z0-9_-]+)/i);
  if (folderMatch?.[1]) return folderMatch[1];

  // open?id= / uc?id= — solo si la URL no es de archivo
  if (!/\/file\/d\//i.test(trimmed)) {
    const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch?.[1]) return idMatch[1];
  }

  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/** Extrae fileId de URL de archivo Drive (no carpetas). */
export function extractDriveFileId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/\/(?:drive\/)?folders\//i.test(trimmed)) return null;

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !/folders/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function splitMultiValue(raw: string): string[] {
  return raw
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isLikelyDriveUrl(value: string): boolean {
  return (
    /drive\.google\.com|docs\.google\.com/i.test(value) ||
    extractDriveFileId(value) != null
  );
}

/**
 * URLs/IDs de archivos de imagen en el CAD (pueden ser varias, separadas por coma/salto).
 * Ignora Street View / Maps que no sean Drive.
 */
export function extractImageUrlsFromCad(cad: CadLike): string[] {
  if (!cad) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const key of IMAGE_URL_KEYS) {
    const raw = sanitizeRaw(cad[key]);
    if (!raw) continue;
    for (const part of splitMultiValue(raw)) {
      if (!isHttpUrl(part) && !extractDriveFileId(part)) continue;
      if (
        isHttpUrl(part) &&
        !isLikelyDriveUrl(part) &&
        !/\/file\/d\//i.test(part)
      ) {
        continue;
      }
      const keyNorm = part.toLowerCase();
      if (seen.has(keyNorm)) continue;
      seen.add(keyNorm);
      urls.push(part);
    }
  }

  return urls.slice(0, MAX_PROPERTY_IMAGES);
}

/** Primera URL de imagen (compat con extractImageUrlFromCad). */
export function extractFirstImageUrlFromCad(cad: CadLike): string | undefined {
  return extractImageUrlsFromCad(cad)[0];
}

/** Carpeta Drive asociada al inmueble (columna Sheet / CAD). */
export function extractDriveFolderIdFromCad(cad: CadLike): string | null {
  if (!cad) return null;
  for (const key of DRIVE_FOLDER_KEYS) {
    const raw = sanitizeRaw(cad[key]);
    const id = extractDriveFolderId(raw);
    if (id) return id;
  }
  return null;
}

/** Meta WPResidence: IDs de adjuntos separados por coma. */
export function formatPropertyImagesMeta(attachmentIds: number[]): string {
  return attachmentIds
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => String(Math.floor(id)))
    .join(',');
}
