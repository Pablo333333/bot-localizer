/** Lectura por nombre de cabecera únicamente (nunca por índice de columna). */

export const COL_ANUNCIO_REVISADO = 'Anuncio Revisado?';
export const COL_ANUNCIO_REVISADO_ALT = 'Anuncio revisado?';

export function normalizeSiToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function findAnuncioRevisadoHeader(
  headerValues?: string[],
): string | null {
  if (!headerValues?.length) return null;

  for (const h of headerValues) {
    if (h === COL_ANUNCIO_REVISADO || h === COL_ANUNCIO_REVISADO_ALT) {
      return h;
    }
  }

  for (const h of headerValues) {
    const n = normalizeSiToken(h);
    if (n.includes('ANUNCIO') && n.includes('REVISAD')) {
      return h;
    }
  }

  return null;
}

export function readAnuncioRevisadoRaw(
  row: { get: (header: string) => unknown },
  headerValues?: string[],
): unknown {
  const named =
    row.get(COL_ANUNCIO_REVISADO) ?? row.get(COL_ANUNCIO_REVISADO_ALT);

  if (named !== undefined && named !== null && String(named).trim() !== '') {
    return named;
  }

  const header = findAnuncioRevisadoHeader(headerValues);
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

/** true solo si la celda es estrictamente SI ("Anuncio Revisado?" por nombre). */
export function isAnuncioRevisadoSi(
  row: { get: (header: string) => unknown },
  headerValues?: string[],
): boolean {
  return normalizeSiToken(readAnuncioRevisadoRaw(row, headerValues)) === 'SI';
}
