/**
 * Retell / Twilio sin saldo: la secuencia no se cierra de inmediato.
 * El paso queda programado y se reintenta con tope (parks + edad).
 */

export const AWAITING_PROVIDER_BALANCE = 'awaiting_provider_balance';

/** Tras agotar el tope el stepRun pasa a failed (sin más requeues). */
export const PROVIDER_BALANCE_EXHAUSTED = 'provider_balance_exhausted';

/** Reintento mientras la cuenta sigue sin saldo. */
export const PROVIDER_BALANCE_RETRY_MS = 10 * 60 * 1000;

/**
 * Máx. aparcamientos (~6 h a 10 min). Evita saturar BullMQ si el saldo
 * no se recupera.
 */
export const PROVIDER_BALANCE_MAX_PARKS = 36;

/** Edad máxima del hold desde el primer park (12 h). */
export const PROVIDER_BALANCE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Solo saldo/créditos. Cuenta inactiva → fallo permanente (permanent-messaging-error). */
/** 30002 (cuenta suspendida) no entra aquí: es fallo permanente. */
const BALANCE_PATTERN =
  /insufficient[_\s-]*(funds|balance|credits)|not enough (credits|balance|funds)|out of (credits|balance|funds)|payment required|saldo insuficiente|sin saldo|sin creditos|sin créditos|\b402\b/i;

export type BalanceHoldState = {
  parks: number;
  sinceMs: number;
};

export function isProviderBalanceError(
  message?: string | null,
  code?: number | string | null,
): boolean {
  const text = `${code ?? ''} ${message ?? ''}`.trim();
  if (!text) return false;
  if (text.startsWith(PROVIDER_BALANCE_EXHAUSTED)) return false;
  if (text.startsWith(AWAITING_PROVIDER_BALANCE)) return true;
  return BALANCE_PATTERN.test(text);
}

export function isAwaitingProviderBalance(lastError?: string | null): boolean {
  if (!lastError) return false;
  return (
    lastError === AWAITING_PROVIDER_BALANCE ||
    lastError.startsWith(`${AWAITING_PROVIDER_BALANCE}|`)
  );
}

export function isProviderBalanceExhausted(lastError?: string | null): boolean {
  if (!lastError) return false;
  return (
    lastError === PROVIDER_BALANCE_EXHAUSTED ||
    lastError.startsWith(`${PROVIDER_BALANCE_EXHAUSTED}|`)
  );
}

/**
 * lastError formato:
 *   awaiting_provider_balance
 *   awaiting_provider_balance|parks=3|since=1710000000000
 */
export function parseBalanceHoldState(
  lastError?: string | null,
  nowMs: number = Date.now(),
): BalanceHoldState | null {
  if (!lastError || !isAwaitingProviderBalance(lastError)) return null;
  if (lastError === AWAITING_PROVIDER_BALANCE) {
    return { parks: 0, sinceMs: nowMs };
  }
  const parksMatch = lastError.match(/\|parks=(\d+)/);
  const sinceMatch = lastError.match(/\|since=(\d+)/);
  return {
    parks: parksMatch ? Number.parseInt(parksMatch[1], 10) || 0 : 0,
    sinceMs: sinceMatch ? Number.parseInt(sinceMatch[1], 10) || nowMs : nowMs,
  };
}

export function formatBalanceHoldState(state: BalanceHoldState): string {
  return `${AWAITING_PROVIDER_BALANCE}|parks=${state.parks}|since=${state.sinceMs}`;
}

export function nextBalanceHoldState(
  lastError?: string | null,
  nowMs: number = Date.now(),
): BalanceHoldState {
  const current = parseBalanceHoldState(lastError, nowMs);
  if (!current) {
    return { parks: 1, sinceMs: nowMs };
  }
  return {
    parks: current.parks + 1,
    sinceMs: current.sinceMs || nowMs,
  };
}

export function shouldExhaustBalanceHold(
  state: BalanceHoldState,
  nowMs: number = Date.now(),
  limits: {
    maxParks?: number;
    maxAgeMs?: number;
  } = {},
): boolean {
  const maxParks = limits.maxParks ?? PROVIDER_BALANCE_MAX_PARKS;
  const maxAgeMs = limits.maxAgeMs ?? PROVIDER_BALANCE_MAX_AGE_MS;
  if (state.parks >= maxParks) return true;
  if (nowMs - state.sinceMs >= maxAgeMs) return true;
  return false;
}
