/**
 * Cada fila del Sheet es una copia propia, indexada por su número real (A1).
 * No se compactan filas vacías: la fila 488 sigue siendo la 488 aunque haya
 * huecos por encima (p. ej. Localizados 452 vs TrasmutadosOtros 488).
 */

import { columnIndexToA1 } from './sheets-tracking';

/** País del anuncio. Columna CI de la fila en curso (1-based 87). */
export const SHEET_COL_PAIS = 'CI';
/** Dirección del anuncio. Columna CX de la fila en curso (1-based 102). */
export const SHEET_COL_DIRECCION = 'CX';
/** Imagen principal del anuncio. Columna P, cabecera "URL Imagen". */
export const SHEET_COL_URL_IMAGEN = 'P';
/** Operación (Alquiler / Venta / Traspaso). Columna F. */
export const SHEET_COL_OPERACION = 'F';
/** Modalidad de traspaso (Venta negocio / Venta con inmueble). Columna G. */
export const SHEET_COL_TRASPASO_MODALIDAD = 'G';
/** Disponibilidad confirmada en la llamada (SI/NO). Columna H. */
export const SHEET_COL_DISPONIBILIDAD = 'H';
/** Precio que va al buscador de WordPress. Columna DH. */
export const SHEET_COL_PRECIO_FILTRO = 'DH';
/** Texto de "antes de la etiqueta de precio". Columna DK. */
export const SHEET_COL_ETIQUETA_PRECIO = 'DK';
/** Última columna de fotos (Foto-exterior-12). Hay que leerla para la galería. */
export const SHEET_COL_LAST_READ = 'DZ';

export const SHEET_COL_PAIS_INDEX0 = columnLetterToIndex0(SHEET_COL_PAIS);
export const SHEET_COL_DIRECCION_INDEX0 = columnLetterToIndex0(SHEET_COL_DIRECCION);

export type IsolatedSheetRow = {
  /** Número de fila 1-based, el mismo que en la UI de Google Sheets. */
  readonly rowNumber: number;
  get(header: string): string;
  getByColumnLetter(letter: string): string;
  toObject(): Record<string, string>;
};

export function columnLetterToIndex0(letter: string): number {
  const clean = String(letter || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!clean) {
    throw new Error(`Columna A1 inválida: ${letter}`);
  }
  let n = 0;
  for (let i = 0; i < clean.length; i++) {
    n = n * 26 + (clean.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Última columna que hay que leer: cubre cabeceras y, como mínimo, DZ. */
export function sheetReadLastColumnLetter(headerCount: number): string {
  const lastIndex = Math.max(
    headerCount - 1,
    columnLetterToIndex0(SHEET_COL_LAST_READ),
    0,
  );
  return columnIndexToA1(lastIndex);
}

export function sheetReadColumnCount(headerCount: number): number {
  return Math.max(
    headerCount,
    columnLetterToIndex0(SHEET_COL_LAST_READ) + 1,
    1,
  );
}

/**
 * Rango devuelto por values.get, p. ej. `'Localizados'!A1:DG904`.
 * Solo informa el bounding box; no sirve para compactar filas.
 */
export function parseA1RangeRows(
  range: string | undefined,
): { start: number; end: number } | null {
  if (!range) return null;
  const pair = range.match(/![A-Z]+(\d+):[A-Z]+(\d+)\s*$/i);
  if (pair) {
    return { start: Number(pair[1]), end: Number(pair[2]) };
  }
  const single = range.match(/![A-Z]+(\d+)\s*$/i);
  if (single) {
    const n = Number(single[1]);
    return { start: n, end: n };
  }
  return null;
}

type GridCell = {
  formattedValue?: string | null;
  hyperlink?: string | null;
  textFormatRuns?: Array<{
    format?: { link?: { uri?: string | null } | null } | null;
  }> | null;
  userEnteredValue?: {
    formulaValue?: string;
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
  } | null;
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
  } | null;
};

function driveUrlFromCell(cell: GridCell): string {
  const candidates = [
    cell.hyperlink,
    ...(cell.textFormatRuns || []).map((run) => run?.format?.link?.uri),
  ];
  for (const raw of candidates) {
    const link = String(raw || '').trim();
    if (/drive\.google\.com|docs\.google\.com/i.test(link)) return link;
  }
  return '';
}

export function gridCellToText(cell: GridCell | null | undefined): string {
  if (!cell) return '';
  const formula = cell.userEnteredValue?.formulaValue;
  if (formula && /HYPERLINK/i.test(formula)) return formula;
  const driveUrl = driveUrlFromCell(cell);
  if (driveUrl) return driveUrl;
  if (cell.formattedValue != null && String(cell.formattedValue) !== '') {
    return String(cell.formattedValue);
  }
  const entered = cell.userEnteredValue;
  const effective = cell.effectiveValue;
  const src = entered?.stringValue != null || entered?.numberValue != null || entered?.boolValue != null
    ? entered
    : effective;
  if (!src) return '';
  if (src.stringValue != null) return String(src.stringValue);
  if (src.numberValue != null) return String(src.numberValue);
  if (src.boolValue != null) return src.boolValue ? 'TRUE' : 'FALSE';
  return '';
}

function headerMatchIndexes(headers: readonly string[], key: string): number[] {
  const wanted = key.trim().toLowerCase();
  const hits: number[] = [];
  headers.forEach((header, index) => {
    if (String(header || '').trim().toLowerCase() === wanted) hits.push(index);
  });
  return hits;
}

/**
 * Snapshot inmutable de UNA fila. `get` solo lee el índice de esa cabecera
 * en esta fila; una cabecera duplicada no elige la columna de otro registro.
 */
export function createIsolatedSheetRow(args: {
  rowNumber: number;
  headers: readonly string[];
  values: readonly unknown[];
  columnCount?: number;
}): IsolatedSheetRow {
  const columnCount = Math.max(
    args.columnCount ?? 0,
    args.headers.length,
    args.values.length,
    columnLetterToIndex0(SHEET_COL_LAST_READ) + 1,
  );
  const cells: string[] = new Array(columnCount).fill('');
  for (let i = 0; i < columnCount; i++) {
    const raw = args.values[i];
    cells[i] = raw == null ? '' : String(raw);
  }
  const headers = args.headers.map((h) => String(h ?? ''));

  return {
    rowNumber: args.rowNumber,
    get(header: string): string {
      const exact = headers.indexOf(header);
      if (exact >= 0) return cells[exact] ?? '';
      const hits = headerMatchIndexes(headers, header);
      if (hits.length !== 1) return '';
      return cells[hits[0]] ?? '';
    },
    getByColumnLetter(letter: string): string {
      const index = columnLetterToIndex0(letter);
      return cells[index] ?? '';
    },
    toObject(): Record<string, string> {
      const out: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        const key = headers[i];
        if (!key || out[key] !== undefined) continue;
        out[key] = cells[i] ?? '';
      }
      return out;
    },
  };
}

/**
 * `startRowIndex0` es el índice 0-based de rowData[0] (fila 2 del sheet → 1).
 * Una entrada vacía en medio NO desplaza las filas siguientes.
 */
export type SheetGridRow = { values?: GridCell[] | null } | null | undefined;

export function isolatedRowsFromGridPage(args: {
  startRowIndex0: number;
  headers: readonly string[];
  rowData: readonly SheetGridRow[] | undefined;
  columnCount: number;
}): IsolatedSheetRow[] {
  const rowData = args.rowData ?? [];
  const out: IsolatedSheetRow[] = [];
  for (let i = 0; i < rowData.length; i++) {
    const rowNumber = args.startRowIndex0 + i + 1;
    const src = rowData[i]?.values ?? [];
    const values: string[] = new Array(args.columnCount).fill('');
    for (let c = 0; c < args.columnCount; c++) {
      values[c] = gridCellToText(src[c]);
    }
    if (!values.some((v) => v.trim())) continue;
    out.push(
      createIsolatedSheetRow({
        rowNumber,
        headers: args.headers,
        values,
        columnCount: args.columnCount,
      }),
    );
  }
  return out;
}
