/**
 * Columnas que el bot puede escribir en Localizados.
 * Cualquier otra (datos originales del inmueble: Municipio, precios, contactos…) está prohibida.
 */
export const BOT_TRACKING_HEADERS = [
  'Llamado',
  'Call ID',
  'Fecha actualizacion',
  'Fecha Llamada',
  'Fecha llamada',
  'Propietario contactado?',
  'Publicado Popalicer?',
  'WP Post ID',
  'Wp Post ID',
  'Referencia',
  'Referencia / WP Post ID',
  'Notas de Error',
  'Estado',
  'Ilocalizable',
] as const;

const TRACKING_LOOKUP = new Set(
  BOT_TRACKING_HEADERS.map((h) => h.trim().toLowerCase()),
);

/** 0-based column index → A1 letter (0=A, 4=E, 87=CJ). */
export function columnIndexToA1(index0: number): string {
  if (index0 < 0 || !Number.isFinite(index0)) {
    throw new Error(`Índice de columna inválido: ${index0}`);
  }
  let n = Math.floor(index0) + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function isTrackingHeader(header: string): boolean {
  return TRACKING_LOOKUP.has(header.trim().toLowerCase());
}

/** Resuelve el nombre real de cabecera en la hoja (case-insensitive). */
export function resolveTrackingHeader(
  header: string,
  sheetHeaders: string[],
): string | undefined {
  if (!isTrackingHeader(header)) return undefined;
  const wanted = header.trim().toLowerCase();
  return sheetHeaders.find((h) => String(h || '').trim().toLowerCase() === wanted);
}

/**
 * Filtra un mapa de campos: solo tracking, solo valores no vacíos,
 * usando los nombres reales de cabecera de la hoja.
 */
export function filterTrackingFields(
  fields: Record<string, string | number | undefined | null>,
  sheetHeaders: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    const header = resolveTrackingHeader(key, sheetHeaders);
    if (!header) continue;
    out[header] = value;
  }
  return out;
}

export function a1ForHeader(
  header: string,
  sheetHeaders: string[],
  rowNumber: number,
): string | undefined {
  const idx = sheetHeaders.indexOf(header);
  if (idx < 0) return undefined;
  return `${columnIndexToA1(idx)}${rowNumber}`;
}
