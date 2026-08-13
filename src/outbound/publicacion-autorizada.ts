/** Columna N (1-based 14 → index 0 = 13). */
export const COL_N_INDEX0 = 13;

export const COL_PUBLICACION_AUTORIZADA = 'Publicacion Autorizada?';
export const COL_PUBLICACION_AUTORIZADA_ALT = 'Publicación Autorizada?';

export function normalizeSiToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Columna N / "Publicacion Autorizada?" debe ser estrictamente SI
 * (ignora mayúsculas, acentos y espacios). Vacío, NO u otro valor → false.
 */
export function isPublicacionAutorizadaSi(
  row: { get: (header: string) => unknown },
  headerValues?: string[],
): boolean {
  const named =
    row.get(COL_PUBLICACION_AUTORIZADA) ??
    row.get(COL_PUBLICACION_AUTORIZADA_ALT);

  let raw = named;
  if (
    (raw === undefined || raw === null || String(raw).trim() === '') &&
    headerValues?.[COL_N_INDEX0]
  ) {
    raw = row.get(headerValues[COL_N_INDEX0]);
  }

  return normalizeSiToken(raw) === 'SI';
}
