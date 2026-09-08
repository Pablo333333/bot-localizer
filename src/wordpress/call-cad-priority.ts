import { sanitizeValue, type RetellCad } from './property-mapper';

/**
 * El dato aportado en la llamada prevalece sobre el valor inicial del Sheet.
 * Vacío / "no especificado" en la llamada no borra el dato previo.
 */
export function preferCallCad(
  sheetCad: RetellCad | undefined,
  callCad: RetellCad | undefined,
): RetellCad {
  const merged: RetellCad = { ...(sheetCad || {}) };
  if (!callCad) return merged;

  for (const [key, raw] of Object.entries(callCad)) {
    const next = sanitizeValue(raw);
    if (!next) continue;
    merged[key] = raw;
  }

  return merged;
}

export function cadHasUsableValue(cad: RetellCad | undefined, key: string): boolean {
  return !!sanitizeValue(cad?.[key]);
}
