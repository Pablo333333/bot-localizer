/** Cabeceras de Localizados usadas como variables Retell. */
export const COL_TIPO_INMUEBLE = 'Tipo de inmueble';
export const COL_DISPONIBILIDAD = 'Disponibilidad del local';
export const COL_MUNICIPIO = 'Municipio';

type SheetRowLike = { get: (header: string) => unknown };

/** Lee una celda tal cual (trim). Sin fallbacks hardcoded. */
export function readSheetString(row: SheetRowLike, header: string): string {
  const raw = row.get(header);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
}

/**
 * Variables dinámicas para Retell al iniciar la llamada outbound.
 * `municipio` sale EXCLUSIVAMENTE de la columna "Municipio" (sin default Palma).
 */
export function buildRetellDynamicVariables(
  row: SheetRowLike,
): Record<string, string> {
  return {
    tipo_inmueble: readSheetString(row, COL_TIPO_INMUEBLE),
    disponibilidad: readSheetString(row, COL_DISPONIBILIDAD),
    municipio: readSheetString(row, COL_MUNICIPIO),
  };
}
