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
