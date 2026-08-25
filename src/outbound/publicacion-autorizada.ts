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
 * Resuelve el header real de "Publicación Autorizada?" en la hoja
 * (exacto, fuzzy por nombre, o columna N / índice 13).
 */
export function findPublicacionAutorizadaHeader(
  headerValues?: string[],
): string | null {
  if (!headerValues?.length) return null;

  for (const h of headerValues) {
    if (
      h === COL_PUBLICACION_AUTORIZADA ||
      h === COL_PUBLICACION_AUTORIZADA_ALT
    ) {
      return h;
    }
  }

  for (const h of headerValues) {
    const n = normalizeSiToken(h);
    if (n.includes('PUBLICACION') && n.includes('AUTORIZAD')) {
      return h;
    }
  }

  const colN = headerValues[COL_N_INDEX0];
  return colN ? colN : null;
}

/** Valor crudo de la celda (para logs de descarte). */
export function readPublicacionAutorizadaRaw(
  row: { get: (header: string) => unknown },
  headerValues?: string[],
): unknown {
  const named =
    row.get(COL_PUBLICACION_AUTORIZADA) ??
    row.get(COL_PUBLICACION_AUTORIZADA_ALT);

  if (named !== undefined && named !== null && String(named).trim() !== '') {
    return named;
  }

  const header = findPublicacionAutorizadaHeader(headerValues);
  if (header) {
    const byHeader = row.get(header);
    if (
      byHeader !== undefined &&
      byHeader !== null &&
      String(byHeader).trim() !== ''
    ) {
      return byHeader;
    }
  }

  return named ?? '';
}

/**
 * Columna N / "Publicacion Autorizada?" debe ser estrictamente SI
 * (ignora mayúsculas, acentos y espacios). Vacío, NO u otro valor → false.
 */
export function isPublicacionAutorizadaSi(
  row: { get: (header: string) => unknown },
  headerValues?: string[],
): boolean {
  return normalizeSiToken(readPublicacionAutorizadaRaw(row, headerValues)) === 'SI';
}
