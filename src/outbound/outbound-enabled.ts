/**
 * Fase 1 — Outbound T+0 (llamadas Retell desde pestaña Localizados).
 * Independiente de Fase 3 (nurturing WA / enroll T+7/T+10).
 *
 * Producción (en paralelo):
 *   OUTBOUND_CALLS_ENABLED=true      ← lote Fase 1 (30/día) a todo el Sheet
 *   NURTURING_PHASE3_ENABLED=true    ← master; código limita a Toni (allowlist)
 *   NURTURING_PHASE3_PHONE_ALLOWLIST= ← vacío = solo +34644408099
 *   OUTBOUND_TEST_PHONE_ONLY=        ← vacío
 *   OUTBOUND_SANDBOX_WHITELIST_ENABLED=false en código
 *   MAX_DAILY_CALLS=30
 *   Horario: L-V 10:00-14:00 y 17:00-20:30 Europe/Madrid
 *
 * Si OUTBOUND_CALLS_ENABLED está vacío, hereda NURTURING_PHASE3_ENABLED
 * (compat). Para Fase 1 con Fase 3 off, hay que poner OUTBOUND_CALLS_ENABLED=true.
 *
 * OUTBOUND_AUTO_DIAL_PAUSED=true bloquea el cron de Fase 1 ( palanca de emergencia ).
 */
export const OUTBOUND_AUTO_DIAL_PAUSED = false;

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
