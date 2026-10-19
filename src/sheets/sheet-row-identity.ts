/**
 * La fila de una ficha se localiza por ID único o por URL de la propiedad.
 * El número de fila solo vale si esa fila sigue siendo el mismo inmueble:
 * un ordenamiento deja el número apuntando a otro anuncio.
 */

import { columnLetterToIndex0 } from './sheet-row-isolation';
import { normalizeSheetHeader } from './sheet-operation-headers';

export const TRASMUTADOS_SHEET_TITLES = [
  'Trasmutados Otros',
  'TrasmutadosOtros',
  'Trasmutados otros',
] as const;

const UNIQUE_ID_HEADERS = [
  'ID único',
  'ID unico',
  'Id único',
  'Id unico',
  'Unique ID',
  'Call ID',
  'ID_WP',
  'WP Post ID',
  'Wp Post ID',
  'Referencia',
  'Referencia / WP Post ID',
] as const;

const PROPERTY_URL_HEADERS = [
  'URL propiedad',
  'URL de la propiedad',
  'URL anuncio',
  'URL del anuncio',
  'Enlace propiedad',
  'Enlace anuncio',
  'Link propiedad',
  'URL',
  'Enlace',
  'Link',
] as const;

const DESCRIPTION_HEADERS = [
  'Descripción por el propietario',
  'Descripcion por el propietario',
  'Descripción',
  'Descripcion',
  'Comentario del anunciante',
  'Comentario anunciante',
] as const;

export type SheetRowLike = {
  rowNumber?: number;
  get: (header: string) => unknown;
  getByColumnLetter?: (letter: string) => unknown;
};

export type SheetRowIdentity = {
  uniqueIds: string[];
  propertyUrls: string[];
};

function normId(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

function normUrl(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(?:www\.)?/, '');
}

export function isPropertyPageUrl(raw: unknown): boolean {
  const value = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (/drive\.google|docs\.google|googleusercontent|google\.com\/maps/i.test(value)) {
    return false;
  }
  return true;
}

function headerMatches(header: string, aliases: readonly string[]): boolean {
  const normalized = normalizeSheetHeader(header);
  if (!normalized) return false;
  return aliases.some((alias) => normalizeSheetHeader(alias) === normalized);
}

function pushUnique(bucket: string[], value: string): void {
  if (!value || bucket.includes(value)) return;
  bucket.push(value);
}

export function readSheetRowIdentity(
  row: SheetRowLike,
  headers?: readonly string[],
): SheetRowIdentity {
  const uniqueIds: string[] = [];
  const propertyUrls: string[] = [];
  const seenHeaders = new Set<string>();

  const consider = (header: string, raw: unknown) => {
    const key = normalizeSheetHeader(header);
    if (!key || seenHeaders.has(key)) return;
    seenHeaders.add(key);
    const text = String(raw ?? '').trim();
    if (!text) return;
    if (headerMatches(header, UNIQUE_ID_HEADERS)) {
      pushUnique(uniqueIds, normId(text));
      return;
    }
    if (headerMatches(header, PROPERTY_URL_HEADERS) && isPropertyPageUrl(text)) {
      pushUnique(propertyUrls, normUrl(text));
    }
  };

  if (headers?.length) {
    for (const header of headers) consider(header, row.get(header));
  }
  for (const alias of [...UNIQUE_ID_HEADERS, ...PROPERTY_URL_HEADERS]) {
    consider(alias, row.get(alias));
  }

  return { uniqueIds, propertyUrls };
}

export function identityHasKey(identity: SheetRowIdentity): boolean {
  return identity.uniqueIds.length > 0 || identity.propertyUrls.length > 0;
}

export function rowMatchesIdentity(
  row: SheetRowLike,
  identity: SheetRowIdentity,
  headers?: readonly string[],
): boolean {
  if (!identityHasKey(identity)) return false;
  const current = readSheetRowIdentity(row, headers);
  if (identity.uniqueIds.some((id) => current.uniqueIds.includes(id))) {
    return true;
  }
  return identity.propertyUrls.some((url) => current.propertyUrls.includes(url));
}

export function findRowByIdentity<T extends SheetRowLike>(
  rows: readonly T[],
  identity: SheetRowIdentity,
  headers?: readonly string[],
): T | null {
  if (!identityHasKey(identity)) return null;
  return rows.find((row) => rowMatchesIdentity(row, identity, headers)) ?? null;
}

/**
 * Si el ID o la URL localizan otra fila, manda esa.
 * El número sugerido solo se usa cuando no hay ID ni URL,
 * o cuando esa fila sigue conteniendo el mismo identificador.
 */
export function resolveRowForCellUpdate<T extends SheetRowLike & { rowNumber: number }>(
  rows: readonly T[],
  hintedRowNumber: number | undefined,
  identity: SheetRowIdentity,
  headers?: readonly string[],
): T | null {
  const byIdentity = findRowByIdentity(rows, identity, headers);
  if (byIdentity) return byIdentity;

  if (hintedRowNumber == null) return null;
  const hinted = rows.find((row) => row.rowNumber === hintedRowNumber) ?? null;
  if (!hinted) return null;
  if (identityHasKey(identity)) return null;
  return hinted;
}

export function descriptionHeadersIn(
  headers: readonly string[],
): string[] {
  const found: string[] = [];
  for (const header of headers) {
    if (!headerMatches(header, DESCRIPTION_HEADERS)) continue;
    if (!found.includes(header)) found.push(header);
  }
  return found;
}

export function columnLetterHeader(
  headers: readonly string[],
  letter: string,
): string | undefined {
  const index = columnLetterToIndex0(letter);
  const header = headers[index];
  const text = String(header ?? '').trim();
  return text || undefined;
}
