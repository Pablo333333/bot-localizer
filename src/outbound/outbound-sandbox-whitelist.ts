import { matchesOutboundTestPhone } from './outbound-test-phone';

/**
 * Sandbox de pruebas: ÚNICO número al que se puede disparar Retell
 * (Fase 1 lote + Fase 3 re-llamadas), da igual lo que haya en Sheets/DB.
 *
 * Desactivar solo al reabrir el lote masivo: OUTBOUND_SANDBOX_WHITELIST_ENABLED=false.
 */
export const OUTBOUND_SANDBOX_WHITELIST_ENABLED = true;

/** Número de prueba Toni (E.164). También acepta 644408099 / +34 644 408 099. */
export const OUTBOUND_SANDBOX_WHITELIST_E164 = '+34644408099';

export const SKIPPED_SANDBOX_WHITELIST = 'skipped_sandbox_whitelist';

export const OUTBOUND_SANDBOX_WHITELIST_LOG =
  `[SANDBOX WHITELIST] ACTIVO — Retell solo puede llamar a ${OUTBOUND_SANDBOX_WHITELIST_E164}. El resto se omite como ${SKIPPED_SANDBOX_WHITELIST}.`;

export function isAllowedOutboundSandboxPhone(phone: string | null | undefined): boolean {
  if (!OUTBOUND_SANDBOX_WHITELIST_ENABLED) return true;
  return matchesOutboundTestPhone(String(phone || ''), OUTBOUND_SANDBOX_WHITELIST_E164);
}

export type SandboxCallGuard =
  | { allowed: true }
  | { allowed: false; skipCode: typeof SKIPPED_SANDBOX_WHITELIST };

/** Última línea de defensa antes de createPhoneCall. */
export function guardOutboundRetellCall(
  toNumber: string | null | undefined,
): SandboxCallGuard {
  if (isAllowedOutboundSandboxPhone(toNumber)) {
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
