export const NURTURING_PHASE3_DISABLED_LOG =
  'Phase 3 Nurturing disabled via environment variable';

/**
 * NURTURING_PHASE3_ENABLED: master switch.
 * Aunque esté true, el código solo aplica Fase 3 a la allowlist de teléfonos
 * (Toni +34644408099 por defecto; ver phase3-allowlist.ts).
 * Ausente o cualquier otro valor → false.
 */
export function isNurturingPhase3Enabled(
  raw?: string | boolean | null,
): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}
