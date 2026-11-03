import { matchesOutboundTestPhone } from '../outbound/outbound-test-phone';

/**
 * Fase 3 (SMS/WA T+0 / enroll T+7 / T+10) — filtro de teléfonos.
 * Aunque NURTURING_PHASE3_ENABLED=true, sin allowlist abierta solo entra Toni.
 *
 * NURTURING_PHASE3_PHONE_ALLOWLIST:
 *   (vacío)              → solo +34644408099 (Toni)
 *   +34611...,+34622...  → esos números
 *   *  | ALL | ANY       → todos los anunciantes (producción)
 */
export const PHASE3_TONI_PHONE_E164 = '+34644408099';

export const PHASE3_ALLOWLIST_DEFAULT = [PHASE3_TONI_PHONE_E164] as const;

/** Tokens que abren Fase 3 a cualquier teléfono. */
export const PHASE3_ALLOWLIST_OPEN_TOKENS = new Set([
  '*',
  'all',
  'any',
  'todos',
  'open',
]);

export const PHASE3_LEAD_NOT_ALLOWED_LOG =
  'Phase 3 Nurturing omitido — lead fuera de allowlist (solo Toni / NURTURING_PHASE3_PHONE_ALLOWLIST)';

export function isPhase3AllowlistOpen(envRaw?: string | null): boolean {
  const raw = String(envRaw ?? '').trim().toLowerCase();
  if (!raw) return false;
  if (PHASE3_ALLOWLIST_OPEN_TOKENS.has(raw)) return true;
  const parts = raw
    .split(/[,;\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.some((part) => PHASE3_ALLOWLIST_OPEN_TOKENS.has(part));
}

/** Texto corto para logs / health: open | toni_default | lista CSV. */
export function describePhase3Allowlist(envRaw?: string | null): string {
  if (isPhase3AllowlistOpen(envRaw)) {
    return 'open (*) — enroll T+7/T+10 para todos los anunciantes';
  }
  const list = resolvePhase3PhoneAllowlist(envRaw);
  const onlyToni =
    list.length === 1 && list[0] === PHASE3_TONI_PHONE_E164;
  if (onlyToni) {
    return `toni_only (${PHASE3_TONI_PHONE_E164}) — resto sin enroll T+7/T+10`;
  }
  return `custom (${list.join(',')})`;
}

export function resolvePhase3PhoneAllowlist(
  envRaw?: string | null,
): string[] {
  if (isPhase3AllowlistOpen(envRaw)) return ['*'];
  const raw = String(envRaw ?? '').trim();
  if (!raw) return [...PHASE3_ALLOWLIST_DEFAULT];
  return raw
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** true si el teléfono puede entrar en Fase 3. */
export function isPhase3AllowedPhone(
  phone: string | null | undefined,
  envAllowlistRaw?: string | null,
): boolean {
  const candidate = String(phone || '');
  if (!candidate.trim()) return false;
  if (isPhase3AllowlistOpen(envAllowlistRaw)) return true;
  const list = resolvePhase3PhoneAllowlist(envAllowlistRaw);
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
