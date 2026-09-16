import { matchesOutboundTestPhone } from '../outbound/outbound-test-phone';

/**
 * Fase 3 (SMS T+0 / enroll T+7 / T+10) — allowlist estricta.
 * Aunque NURTURING_PHASE3_ENABLED=true, solo estos teléfonos entran en nurturing.
 * El resto de leads opera solo Fase 1 (lote diario).
 *
 * Override opcional: NURTURING_PHASE3_PHONE_ALLOWLIST=+34644408099,+34...
 */
export const PHASE3_TONI_PHONE_E164 = '+34644408099';

export const PHASE3_ALLOWLIST_DEFAULT = [PHASE3_TONI_PHONE_E164] as const;

export const PHASE3_LEAD_NOT_ALLOWED_LOG =
  'Phase 3 Nurturing omitido — lead fuera de allowlist (solo Toni / NURTURING_PHASE3_PHONE_ALLOWLIST)';

export function resolvePhase3PhoneAllowlist(
  envRaw?: string | null,
): string[] {
  const raw = String(envRaw ?? '').trim();
  if (!raw) return [...PHASE3_ALLOWLIST_DEFAULT];
  return raw
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** true si el teléfono está en la allowlist de Fase 3 (Toni por defecto). */
export function isPhase3AllowedPhone(
  phone: string | null | undefined,
  envAllowlistRaw?: string | null,
): boolean {
  const list = resolvePhase3PhoneAllowlist(envAllowlistRaw);
  const candidate = String(phone || '');
  if (!candidate.trim()) return false;
  return list.some((allowed) => matchesOutboundTestPhone(candidate, allowed));
}

/**
 * Master switch env + allowlist de teléfono.
 * Fase 3 solo si ambos pasan.
 */
export function canRunPhase3ForPhone(params: {
  phase3EnabledRaw?: string | boolean | null;
  phone?: string | null;
  allowlistEnvRaw?: string | null;
  isPhase3Enabled: (raw?: string | boolean | null) => boolean;
}): boolean {
  if (!params.isPhase3Enabled(params.phase3EnabledRaw)) return false;
  return isPhase3AllowedPhone(params.phone, params.allowlistEnvRaw);
}
