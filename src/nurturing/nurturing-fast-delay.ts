import {
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
} from './toni-fase3.constants';

/** Prueba en vivo: la llamada 2 sale a los 3 minutos de la llamada 1. */
export const NURTURING_FAST_T7_MINUTES_DEFAULT = 3;
/** Prueba en vivo: la llamada 3 sale a los 5 minutos de cerrar la llamada 2. */
export const NURTURING_FAST_T10_MINUTES_DEFAULT = 5;

export function isNurturingFastTest(raw?: string | boolean | null): boolean {
  if (typeof raw === 'boolean') return raw;
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si' || v === 'sí';
}

export function parsePositiveMinutes(raw: unknown, fallback: number): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

/**
 * Con NURTURING_FAST_TEST, T+7 y T+10 no usan los días guardados en la secuencia.
 * El resto de pasos conserva delayMinutes de base de datos.
 */
export function resolveNurturingStepDelayMinutes(params: {
  templateKey?: string | null;
  storedDelayMinutes: number;
  fastTestRaw?: string | boolean | null;
  fastT7MinutesRaw?: unknown;
  fastT10MinutesRaw?: unknown;
}): number {
  if (!isNurturingFastTest(params.fastTestRaw)) {
    return params.storedDelayMinutes;
  }
  if (params.templateKey === TEMPLATE_CALL_FOLLOWUP_D7) {
    return parsePositiveMinutes(
      params.fastT7MinutesRaw,
      NURTURING_FAST_T7_MINUTES_DEFAULT,
    );
  }
  if (params.templateKey === TEMPLATE_CALL_FOLLOWUP_D10) {
    return parsePositiveMinutes(
      params.fastT10MinutesRaw,
      NURTURING_FAST_T10_MINUTES_DEFAULT,
    );
  }
  return params.storedDelayMinutes;
}

export function nurturingStepLabel(templateKey?: string | null): string {
  if (templateKey === TEMPLATE_CALL_FOLLOWUP_D7) return 'llamada 2 (T+7)';
  if (templateKey === TEMPLATE_CALL_FOLLOWUP_D10) return 'llamada 3 (T+10)';
  return templateKey || 'paso';
}

export function formatMadridDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
