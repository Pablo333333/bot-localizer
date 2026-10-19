import {
  findDisponibilidadHeader,
  parseDisponibilidadConfirmada,
} from '../../sheets/sheet-operation-headers';
import { SHEET_COL_DISPONIBILIDAD } from '../../sheets/sheet-row-isolation';

type CallLike = {
  call_analysis?: { custom_analysis_data?: Record<string, unknown> };
  collected_dynamic_variables?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
};

function disponibilidadFrom(
  source: Record<string, unknown> | undefined,
): unknown {
  if (!source) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, 'disponibilidad')) {
    return undefined;
  }
  return source.disponibilidad;
}

/**
 * El propietario dijo en la llamada que el inmueble no está disponible
 * (columna H = NO). La fuente del análisis gana sobre las variables iniciales.
 */
export function callSaysPropertyUnavailable(callData: CallLike): boolean {
  const sources = [
    disponibilidadFrom(callData.call_analysis?.custom_analysis_data),
    disponibilidadFrom(callData.collected_dynamic_variables),
    disponibilidadFrom(callData.retell_llm_dynamic_variables),
  ];
  for (const raw of sources) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    return parseDisponibilidadConfirmada(raw) === 'NO';
  }
  return false;
}

type SheetRowLike = {
  get: (header: string) => unknown;
  getByColumnLetter?: (letter: string) => unknown;
};

/**
 * No disparar WhatsApp/SMS de seguimiento si la columna H es NO
 * o el propietario rechazó el contacto.
 */
export function shouldSendFase3FollowupMessage(input: {
  disponibilidad?: unknown;
  rejected?: boolean;
}): boolean {
  if (input.rejected) return false;
  if (parseDisponibilidadConfirmada(input.disponibilidad) === 'NO') return false;
  return true;
}

/** Columna H de la fila, por cabecera o por letra. */
export function sheetRowSaysPropertyUnavailable(
  row: SheetRowLike,
  headers?: readonly string[],
): boolean {
  const header = findDisponibilidadHeader(headers);
  const raw = header
    ? row.get(header)
    : row.getByColumnLetter?.(SHEET_COL_DISPONIBILIDAD);
  return parseDisponibilidadConfirmada(raw) === 'NO';
}
