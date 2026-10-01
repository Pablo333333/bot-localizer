/** Mínimo entre dos intentos o llamadas completadas al mismo teléfono. */
export const CALL_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/**
 * true si el último intento o llamada completada sigue dentro del cooldown.
 * Timestamps futuros o inválidos no abren el filtro.
 */
export function isWithinCallCooldown(
  lastAttemptMs: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(lastAttemptMs) || !Number.isFinite(now)) return false;
  const age = now - lastAttemptMs;
  return age >= 0 && age < CALL_COOLDOWN_MS;
}

/** El instante más reciente entre fechas de intento/llamada ya parseadas. */
export function latestAttemptTimestamp(
  candidates: Array<number | null | undefined>,
): number | null {
  let newest: number | null = null;
  for (const ts of candidates) {
    if (ts == null || !Number.isFinite(ts)) continue;
    if (newest == null || ts > newest) newest = ts;
  }
  return newest;
}
