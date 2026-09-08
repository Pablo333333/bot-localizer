/**
 * Fase 1 — Outbound T+0 (llamadas Retell desde pestaña Localizados).
 * Independiente de Fase 3 (nurturing WA / enroll T+7/T+10).
 *
 * Lunes / lote diario:
 *   OUTBOUND_CALLS_ENABLED=true
 *   NURTURING_PHASE3_ENABLED=false   ← pausa nurturing masivo
 *   OUTBOUND_TEST_PHONE_ONLY=        ← vacío (sin filtro Toni)
 *   MAX_DAILY_CALLS=30
 *
 * Si OUTBOUND_CALLS_ENABLED está vacío, hereda NURTURING_PHASE3_ENABLED
 * (compat). Para Fase 1 con Fase 3 off, hay que poner OUTBOUND_CALLS_ENABLED=true.
 *
 * PAUSA TEMPORAL PRE-DEPLOY: con OUTBOUND_AUTO_DIAL_PAUSED=true no se llama
 * a nadie (ni cron Fase 1 ni re-llamadas Fase 3), aunque Railway tenga
 * OUTBOUND_CALLS_ENABLED=true. Webhooks y sync siguen vivos.
 * Para reactivar: poner esta constante en false y descomentar el @Cron.
 */
export const OUTBOUND_AUTO_DIAL_PAUSED = true;

export const OUTBOUND_AUTO_DIAL_PAUSED_LOG =
  'Outbound AUTO-DIAL PAUSADO en código — no se lanzan llamadas Retell (Fase 1 / Fase 3). Webhooks y sync siguen activos.';

export const OUTBOUND_CALLS_DISABLED_LOG =
  'Outbound calls disabled via environment variable';

export const OUTBOUND_PHASE1_ACTIVE_LOG =
  'Outbound Fase 1 ACTIVO (lote Localizados → Retell). Fase 3 nurturing aislada/off.';

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

/** Resumen operativo para logs / status. */
export function describeOutboundMode(params: {
  outboundCallsEnabled?: string | boolean | null;
  nurturingPhase3Enabled?: string | boolean | null;
  testPhoneOnly?: string | null;
  maxDailyCalls?: number;
}): {
  outboundEnabled: boolean;
  phase3NurturingEnabled: boolean;
  phase1MassBatch: boolean;
  testFilterActive: boolean;
  maxDailyCalls: number;
} {
  const outboundEnabled = isOutboundCallsEnabled(params);
  const phase3NurturingEnabled = isTruthyEnvFlag(params.nurturingPhase3Enabled);
  const testFilterActive = Boolean(params.testPhoneOnly?.trim());
  return {
    outboundEnabled,
    phase3NurturingEnabled,
    /** Lote masivo Fase 1: outbound on, sin filtro Toni (Fase 3 puede estar off). */
    phase1MassBatch: outboundEnabled && !testFilterActive,
    testFilterActive,
    maxDailyCalls: params.maxDailyCalls ?? 30,
  };
}
