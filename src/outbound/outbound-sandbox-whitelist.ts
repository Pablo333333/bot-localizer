import { matchesOutboundTestPhone } from './outbound-test-phone';

/**
 * Cortafuegos de prueba (Toni): si está activo, Retell solo llama a
 * OUTBOUND_SANDBOX_WHITELIST_E164, da igual lo que haya en Sheets/DB.
 * También filtra follow-up Fase 3 (SMS/enroll) vía isAllowedOutboundSandboxPhone.
 *
 * Producción: OUTBOUND_SANDBOX_WHITELIST_ENABLED=false (o ausente).
 * Fase 1 lote diario (30) a números reales del Sheet.
 * Fase 3 (T+7/T+10 de Toni u otros enrollados) sigue vía NURTURING_PHASE3_ENABLED.
 *
 * Constante de código = default si env vacío. Env puede forzar true/false en Railway
 * sin redeploy de lógica (solo restart).
 */
const OUTBOUND_SANDBOX_WHITELIST_ENABLED_DEFAULT = false;

/** Número de prueba Toni (E.164). También acepta 644408099 / +34 644 408 099. */
export const OUTBOUND_SANDBOX_WHITELIST_E164 = '+34644408099';

export const SKIPPED_SANDBOX_WHITELIST = 'skipped_sandbox_whitelist';

export const OUTBOUND_SANDBOX_WHITELIST_LOG =
  `[SANDBOX WHITELIST] ACTIVO — Retell solo puede llamar a ${OUTBOUND_SANDBOX_WHITELIST_E164}. El resto se omite como ${SKIPPED_SANDBOX_WHITELIST}.`;

function isTruthyEnvFlag(raw?: string | boolean | null): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}

/**
 * Lee el flag en cada llamada (permite cambiar env en Railway).
 * Default producción: false.
 */
export function isOutboundSandboxWhitelistEnabled(
  envRaw?: string | boolean | null,
): boolean {
  if (
    envRaw !== undefined &&
    envRaw !== null &&
    String(envRaw).trim() !== ''
  ) {
    return isTruthyEnvFlag(envRaw);
  }
  const fromProcess = process.env.OUTBOUND_SANDBOX_WHITELIST_ENABLED;
  if (fromProcess !== undefined && String(fromProcess).trim() !== '') {
    return isTruthyEnvFlag(fromProcess);
  }
  return OUTBOUND_SANDBOX_WHITELIST_ENABLED_DEFAULT;
}

/** @deprecated Usar isOutboundSandboxWhitelistEnabled() — se mantiene para imports legacy. */
export const OUTBOUND_SANDBOX_WHITELIST_ENABLED =
  OUTBOUND_SANDBOX_WHITELIST_ENABLED_DEFAULT;

export function isAllowedOutboundSandboxPhone(
  phone: string | null | undefined,
  envRaw?: string | boolean | null,
): boolean {
  if (!isOutboundSandboxWhitelistEnabled(envRaw)) return true;
  return matchesOutboundTestPhone(
    String(phone || ''),
    OUTBOUND_SANDBOX_WHITELIST_E164,
  );
}

export type SandboxCallGuard =
  | { allowed: true }
  | { allowed: false; skipCode: typeof SKIPPED_SANDBOX_WHITELIST };

/** Última línea de defensa antes de createPhoneCall. */
export function guardOutboundRetellCall(
  toNumber: string | null | undefined,
  envRaw?: string | boolean | null,
): SandboxCallGuard {
  if (isAllowedOutboundSandboxPhone(toNumber, envRaw)) {
    return { allowed: true };
  }
  return { allowed: false, skipCode: SKIPPED_SANDBOX_WHITELIST };
}

type RetellCreatePhoneCall = {
  call: {
    createPhoneCall: (params: {
      from_number: string;
      to_number: string;
      override_agent_id: string;
      retell_llm_dynamic_variables?: Record<string, string>;
    }) => Promise<{ call_id?: string }>;
  };
};

/**
 * Intercepta todo disparo Retell. Si el destino no es la whitelist, no llama.
 */
export async function safeCreatePhoneCall(
  retell: RetellCreatePhoneCall,
  params: {
    from_number: string;
    to_number: string;
    override_agent_id: string;
    retell_llm_dynamic_variables?: Record<string, string>;
  },
  log?: (message: string) => void,
): Promise<
  | { skipped: true; skipCode: typeof SKIPPED_SANDBOX_WHITELIST }
  | { skipped: false; call: { call_id?: string } }
> {
  const guard = guardOutboundRetellCall(params.to_number);
  if (!guard.allowed) {
    log?.(
      `[SANDBOX WHITELIST] ${SKIPPED_SANDBOX_WHITELIST} to=${params.to_number} (solo ${OUTBOUND_SANDBOX_WHITELIST_E164})`,
    );
    return { skipped: true, skipCode: SKIPPED_SANDBOX_WHITELIST };
  }

  const call = await retell.call.createPhoneCall(params);
  return { skipped: false, call };
}
