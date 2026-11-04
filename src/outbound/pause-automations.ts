/**
 * Palanca de emergencia: pausa llamadas Retell automáticas y envíos
 * automáticos de WhatsApp (Fase 1 + Fase 3) sin tumbar webhooks ni sync.
 *
 * PAUSE_ALL_AUTOMATIONS=true|1|yes|si
 */
export const PAUSE_ALL_AUTOMATIONS_LOG =
  'PAUSE_ALL_AUTOMATIONS=true — Retell auto-dial y WhatsApp automático detenidos. Webhooks y sync siguen activos.';

function isTruthyEnvFlag(raw?: string | boolean | null): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si' || v === 'sí';
}

export function isPauseAllAutomations(
  raw?: string | boolean | null,
): boolean {
  return isTruthyEnvFlag(raw);
}
