/**
 * Outbound T+0 (llamadas Retell desde pestaña Localizados).
 * OUTBOUND_CALLS_ENABLED tiene prioridad; si no está, hereda NURTURING_PHASE3_ENABLED.
 */
export const OUTBOUND_CALLS_DISABLED_LOG =
  'Outbound calls disabled via environment variable';

function isTruthyEnvFlag(raw?: string | boolean | null): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}

export function isOutboundCallsEnabled(params: {
  outboundCallsEnabled?: string | boolean | null;
  nurturingPhase3Enabled?: string | boolean | null;
}): boolean {
  if (
    params.outboundCallsEnabled !== undefined &&
    params.outboundCallsEnabled !== null &&
    String(params.outboundCallsEnabled).trim() !== ''
  ) {
    return isTruthyEnvFlag(params.outboundCallsEnabled);
  }
  return isTruthyEnvFlag(params.nurturingPhase3Enabled);
}
