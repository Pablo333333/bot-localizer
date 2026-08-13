export const NURTURING_PHASE3_DISABLED_LOG =
  'Phase 3 Nurturing disabled via environment variable';

/**
 * NURTURING_PHASE3_ENABLED: solo true / 'true' / '1' / 'yes' / 'si' activan Fase 3.
 * Ausente o cualquier otro valor → false (producción Railway por defecto).
 */
export function isNurturingPhase3Enabled(
  raw?: string | boolean | null,
): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}
