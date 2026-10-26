/** Huecos de cita en hora civil de Madrid, sin depender del reloj del servidor. */

export const MADRID_TZ = 'Europe/Madrid';
export const SLOT_DURATION_MS = 30 * 60 * 1000;
export const DAY_START_MINUTES = 9 * 60;
export const DAY_END_MINUTES = 18 * 60;
export const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
export const LOOKAHEAD_DAYS = 7;
export const MAX_SLOTS = 6;

export type BusyInterval = { startMs: number; endMs: number };

export type CalendarSlot = {
  inicioIso: string;
  etiqueta: string;
  startMs: number;
};

export type MadridParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function madridParts(date: Date): MadridParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: MADRID_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Convierte una hora de pared en Madrid al instante UTC correspondiente. */
export function madridWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const seen = madridParts(guess);
  const seenAsUtc = Date.UTC(
    seen.year,
    seen.month - 1,
    seen.day,
    seen.hour,
    seen.minute,
    seen.second,
  );
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(guess.getTime() + (wanted - seenAsUtc));
}

export function weekdayOfCivilDate(
  year: number,
  month: number,
  day: number,
): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addCivilDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatMadridOffsetIso(date: Date): string {
  const parts = madridParts(date);
  const wallUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offsetMin = Math.round((wallUtc - date.getTime()) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function formatMadridSlotLabel(date: Date): string {
  const parts = madridParts(date);
  const weekday = new Intl.DateTimeFormat('es-ES', {
    timeZone: MADRID_TZ,
    weekday: 'long',
  }).format(date);
  const month = new Intl.DateTimeFormat('es-ES', {
    timeZone: MADRID_TZ,
    month: 'long',
  }).format(date);
  return `${weekday} ${parts.day} de ${month} a las ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function intervalsOverlap(
  startMs: number,
  endMs: number,
  busy: BusyInterval[],
): boolean {
  return busy.some(
    (interval) => startMs < interval.endMs && endMs > interval.startMs,
  );
}

export function isWithinBookingWindow(start: Date): boolean {
  const parts = madridParts(start);
  if (weekdayOfCivilDate(parts.year, parts.month, parts.day) % 6 === 0) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  return (
    minutes >= DAY_START_MINUTES &&
    minutes + SLOT_DURATION_MS / 60000 <= DAY_END_MINUTES &&
    parts.second === 0 &&
    parts.minute % 30 === 0
  );
}

export function listFreeSlots(options: {
  now: Date;
  busy?: BusyInterval[];
  limit?: number;
  leadMs?: number;
}): CalendarSlot[] {
  const now = options.now;
  const busy = options.busy ?? [];
  const limit = options.limit ?? MAX_SLOTS;
  const leadMs = options.leadMs ?? MIN_LEAD_MS;
  const today = madridParts(now);
  const slots: CalendarSlot[] = [];

  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
    const civil = addCivilDays(today.year, today.month, today.day, offset);
    if (weekdayOfCivilDate(civil.year, civil.month, civil.day) % 6 === 0) {
      continue;
    }
    for (
      let minutes = DAY_START_MINUTES;
      minutes + SLOT_DURATION_MS / 60000 <= DAY_END_MINUTES;
      minutes += SLOT_DURATION_MS / 60000
    ) {
      const start = madridWallToUtc(
        civil.year,
        civil.month,
        civil.day,
        Math.floor(minutes / 60),
        minutes % 60,
      );
      if (start.getTime() < now.getTime() + leadMs) continue;
      const endMs = start.getTime() + SLOT_DURATION_MS;
      if (intervalsOverlap(start.getTime(), endMs, busy)) continue;
      slots.push({
        inicioIso: formatMadridOffsetIso(start),
        etiqueta: formatMadridSlotLabel(start),
        startMs: start.getTime(),
      });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

/**
 * Acepta el inicio_iso que devolvió consultar, o una frase
 * "27/10/2026 a las 10:00", "mañana a las 10:00" u "hoy a las 16:30".
 */
export function parseSlotInput(
  raw: string | undefined | null,
  now: Date,
): Date | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const clock = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;

  const numeric = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (numeric) {
    return madridWallToUtc(
      Number(numeric[3]),
      Number(numeric[2]),
      Number(numeric[1]),
      hour,
      minute,
    );
  }

  const today = madridParts(now);
  let civil = { year: today.year, month: today.month, day: today.day };
  if (/mañana|manana/i.test(text)) {
    civil = addCivilDays(civil.year, civil.month, civil.day, 1);
  } else if (!/\bhoy\b/i.test(text)) {
    return null;
  }
  return madridWallToUtc(civil.year, civil.month, civil.day, hour, minute);
}
