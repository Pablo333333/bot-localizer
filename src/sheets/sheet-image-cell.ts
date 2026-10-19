/**
 * Columna Q ("URL Imagen") solo acepta un enlace o ruta de imagen.
 * Una fecha de modificación o un timestamp no puede pisar esa celda.
 */

const DATE_OR_TIMESTAMP =
  /^(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{10,16}(?:\.\d+)?)$/;

const IMAGE_PATH =
  /^(?:[\w.-]+\/)+[\w.-]+\.(?:jpe?g|png|webp|gif|bmp)$/i;

function isDriveImageRef(value: string): boolean {
  return /drive\.google\.com|docs\.google\.com|googleusercontent\.com/i.test(
    value,
  );
}

export function isAcceptedImageCellValue(raw: unknown): boolean {
  const value = String(raw ?? '').trim();
  if (!value) return false;
  if (DATE_OR_TIMESTAMP.test(value)) return false;
  if (/^\d+(\.\d+)?$/.test(value)) return false;
  if (/HYPERLINK/i.test(value)) return isDriveImageRef(value);
  if (isDriveImageRef(value)) return true;
  if (IMAGE_PATH.test(value)) return true;
  return false;
}

/** Deja solo URLs/rutas válidas. Fechas y timestamps desaparecen. */
export function sanitizeSheetImageValue(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/HYPERLINK/i.test(value)) {
    return isAcceptedImageCellValue(value) ? value : '';
  }
  const kept = value
    .split(/[\n,;|]+/)
    .map((part) => part.trim())
    .filter((part) => isAcceptedImageCellValue(part));
  return kept.join(', ');
}

export function isUrlImagenHeader(header: string): boolean {
  const normalized = String(header || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_?/]+/g, ' ')
    .replace(/\s+/g, ' ');
  return (
    normalized === 'url imagen' ||
    normalized === 'url imagenes' ||
    normalized === 'urls imagenes' ||
    normalized === 'imagen url'
  );
}
