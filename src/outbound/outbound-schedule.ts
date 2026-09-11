/** Límite diario por defecto de llamadas outbound (Localizados → Retell). */
export const DEFAULT_MAX_DAILY_CALLS = 30;

export const OUTBOUND_TIMEZONE = 'Europe/Madrid';

/** L-V ventana general: 10:00–20:30 Madrid. */
export const BUSINESS_START_MINUTES = 10 * 60;
export const BUSINESS_END_MINUTES = 20 * 60 + 30;

/** Pausa anunciantes: no llamar [14:00, 17:00). */
export const LUNCH_BREAK_START_MINUTES = 14 * 60;
export const LUNCH_BREAK_END_MINUTES = 17 * 60;

export const OUTBOUND_HOURS_DESCRIPTION =
  'L-V 10:00-14:00 y 17:00-20:30 Europe/Madrid (pausa 14:00-17:00)';

/** Espaciado orgánico entre llamadas (anti-ráfaga / antispam operadoras). */
export const DEFAULT_OUTBOUND_DELAY_MIN_MS = 5 * 60_000;
export const DEFAULT_OUTBOUND_DELAY_MAX_MS = 10 * 60_000;

export function resolveMaxDailyCalls(raw?: string | number | null): number {
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_MAX_DAILY_CALLS;
  }
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_DAILY_CALLS;
  }
  return Math.floor(n);
}

function parsePositiveMs(
  raw: string | number | null | undefined,
  fallback: number,
): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Rango de espera entre llamadas consecutivas.
 * Env: OUTBOUND_DELAY_MIN_MS / OUTBOUND_DELAY_MAX_MS (default 5–10 min).
 */
export function resolveOutboundDelayRangeMs(options?: {
  minRaw?: string | number | null;
  maxRaw?: string | number | null;
}): { minMs: number; maxMs: number } {
  let minMs = parsePositiveMs(
    options?.minRaw,
    DEFAULT_OUTBOUND_DELAY_MIN_MS,
  );
  let maxMs = parsePositiveMs(
    options?.maxRaw,
    DEFAULT_OUTBOUND_DELAY_MAX_MS,
  );
  if (maxMs < minMs) {
    const swap = minMs;
    minMs = maxMs;
    maxMs = swap;
  }
  return { minMs, maxMs };
}

/** Delay aleatorio uniforme en [minMs, maxMs] (ms enteros). */
export function pickOutboundInterCallDelayMs(
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const lo = Math.max(0, Math.floor(minMs));
  const hi = Math.max(lo, Math.floor(maxMs));
  if (hi === lo) return lo;
  return lo + Math.floor(random() * (hi - lo + 1));
}

/**
 * Horario permitido para disparar llamadas (hora civil Madrid).
 * L-V, 10:00–20:30, excluyendo 14:00–17:00.
 */
export function isWithinOutboundCallHours(parts: {
  weekday: number;
  hour: number;
  minute: number;
}): boolean {
  if (parts.weekday === 0 || parts.weekday === 6) return false;
  const minutes = parts.hour * 60 + parts.minute;
  if (minutes < BUSINESS_START_MINUTES || minutes > BUSINESS_END_MINUTES) {
    return false;
  }
  if (
    minutes >= LUNCH_BREAK_START_MINUTES &&
    minutes < LUNCH_BREAK_END_MINUTES
  ) {
    return false;
  }
  return true;
}
