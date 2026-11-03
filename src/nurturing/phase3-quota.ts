/**
 * Cupo diario independiente de la Fase 3 (backfill / absorción de no contactados).
 * Separado de MAX_DAILY_CALLS (Fase 1 / marcador outbound).
 */

export const DEFAULT_MAX_DAILY_PHASE3_LEADS = 30;

export const PHASE3_BACKFILL_SOURCE = 'sheets_backfill_unreached';

export function resolveMaxDailyPhase3Leads(
  raw?: string | number | null,
): number {
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_MAX_DAILY_PHASE3_LEADS;
  }
  const n =
    typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_DAILY_PHASE3_LEADS;
  }
  return Math.floor(n);
}

export function remainingPhase3DailyQuota(params: {
  usedToday: number;
  maxDaily?: number | null;
}): number {
  const max = params.maxDaily ?? DEFAULT_MAX_DAILY_PHASE3_LEADS;
  return Math.max(0, max - Math.max(0, params.usedToday));
}
