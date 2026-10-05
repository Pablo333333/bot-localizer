/**
 * Retell / Twilio sin saldo: la secuencia no se cierra.
 * El paso queda programado y se vuelve a intentar cuando el proveedor cobre.
 */

export const AWAITING_PROVIDER_BALANCE = 'awaiting_provider_balance';

/** Reintento mientras la cuenta sigue sin saldo. No es un fallo terminal. */
export const PROVIDER_BALANCE_RETRY_MS = 10 * 60 * 1000;

const BALANCE_PATTERN =
  /insufficient[_\s-]*(funds|balance|credits)|not enough (credits|balance|funds)|out of (credits|balance|funds)|payment required|saldo insuficiente|sin saldo|sin creditos|sin créditos|account (is )?suspended|\b402\b|\b30002\b/i;

export function isProviderBalanceError(
  message?: string | null,
  code?: number | string | null,
): boolean {
  const text = `${code ?? ''} ${message ?? ''}`.trim();
  if (!text) return false;
  return BALANCE_PATTERN.test(text);
}
