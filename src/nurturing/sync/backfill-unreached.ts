import { isOwnerContactRecorded } from '../../wordpress/listing-creation-guard';
import {
  isPublicacionAutorizadaSi,
  normalizeSiToken,
} from '../../outbound/publicacion-autorizada';
import { alreadyHandledAdReason } from '../engine/already-handled-ad';

export const BACKFILL_SHEET_NAME = 'Localizados';
export const COL_LLAMADO = 'Llamado';
export const COL_CALL_ID = 'Call ID';
export const COL_PROPIETARIO_CONTACTADO = 'Propietario contactado?';
export const COL_TEL_CONTACTO1 = 'Teléfono contacto1';
export const COL_TELEFONO1 = 'Telefono1';
export const COL_TELEFONO2 = 'Telefono2';
export const COL_TELEFONO3 = 'Telefono3';
export const COL_NOMBRE_CONTACTO1 = 'Nombre contacto1';

const LLAMADO_MARKED = new Set(['SI', 'SÍ', 'YES', 'TRUE', 'INTENTADO', '1']);

type SheetRowLike = { get: (header: string) => unknown };

/** Fila ya discada (Llamado=SI / INTENTADO o Call ID presente). */
export function sheetRowWasCalled(row: SheetRowLike): boolean {
  const llamado = normalizeSiToken(row.get(COL_LLAMADO));
  if (LLAMADO_MARKED.has(llamado) || llamado === 'SI') return true;
  const callId = String(row.get(COL_CALL_ID) ?? '').trim();
  return callId.length > 0;
}

/**
 * Cierre de conversión exitoso: Propietario contactado? válido
 * o Publicacion Autorizada? = SI (o WP Post ID vía alreadyHandled).
 */
export function sheetRowHasSuccessfulConversion(
  row: SheetRowLike,
  headerValues?: string[],
): boolean {
  if (
    isOwnerContactRecorded(
      row.get(COL_PROPIETARIO_CONTACTADO) ??
        row.get('Propietario contactado'),
    )
  ) {
    return true;
  }
  if (isPublicacionAutorizadaSi(row, headerValues)) {
    return true;
  }
  return alreadyHandledAdReason(row, headerValues) != null;
}

/** Candidato a backfill Fase 3: llamado sin cierre de conversión. */
export function isBackfillUnreachedCandidate(
  row: SheetRowLike,
  headerValues?: string[],
): boolean {
  if (!sheetRowWasCalled(row)) return false;
  if (sheetRowHasSuccessfulConversion(row, headerValues)) return false;
  return true;
}

export function extractBackfillPhoneRaw(row: SheetRowLike): string | null {
  const candidates = [
    row.get(COL_TEL_CONTACTO1),
    row.get(COL_TELEFONO1),
    row.get(COL_TELEFONO2),
    row.get(COL_TELEFONO3),
  ];
  for (const c of candidates) {
    const value = String(c ?? '').trim();
    if (value) return value;
  }
  return null;
}
