/** Un ciclo colgado no puede bloquear el lote de los días siguientes. */
export const OUTBOUND_CYCLE_STALE_MS = 3 * 60 * 1000;

export function shouldSkipOutboundCycle(
  state: { running: boolean; runningSince: number },
  nowMs: number,
): boolean {
  if (!state.running) return false;
  return nowMs - state.runningSince < OUTBOUND_CYCLE_STALE_MS;
}

/**
 * Fallo de credencial o de token (Google, Retell o BullMQ), no un error de negocio.
 * No usa la palabra suelta "token" para no confundirla con un identificador de fila.
 */
export function isProviderTokenFailure(message?: string | null): boolean {
  const text = String(message ?? '');
  if (!text) return false;
  return /invalid_grant|invalid_rapt|invalid_token|invalid authentication|unauthenticated|unauthorized|api[_ ]?key|missing lock|job token|moveToDelayed|\b401\b|invalid_client/i.test(
    text,
  );
}

export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} superó ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
