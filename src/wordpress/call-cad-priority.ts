import { isInvalidAnalyzedValue } from '../sheets/sheets-cad-updates';
import {
  operationIncludesTraspaso,
  resolveTraspasoModalidad,
} from '../sheets/sheet-operation-headers';
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
    if (isInvalidAnalyzedValue(raw)) continue;
    const next = sanitizeValue(raw);
    if (!next) continue;
    merged[key] = raw;
  }

  const operation = merged.contrato || merged.operacion;
  if (!operationIncludesTraspaso(operation)) {
    delete merged.modalidad_traspaso;
  } else {
    const modalidad = resolveTraspasoModalidad(
      operation,
      merged.modalidad_traspaso,
    );
    if (modalidad) merged.modalidad_traspaso = modalidad;
    else delete merged.modalidad_traspaso;
  }

  return merged;
}

export function cadHasUsableValue(cad: RetellCad | undefined, key: string): boolean {
  return !!sanitizeValue(cad?.[key]);
}
