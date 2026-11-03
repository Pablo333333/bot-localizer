import { madridWallToUtc } from '../v2/calendar-slots';
import {
  DEFAULT_MAX_DAILY_CALLS,
  DEFAULT_OUTBOUND_DELAY_MAX_MS,
  DEFAULT_OUTBOUND_DELAY_MIN_MS,
  alignToOutboundBusinessHours,
  isWithinOutboundCallHours,
  madridOutboundParts,
  pickOutboundInterCallDelayMs,
  resolveMaxDailyCalls,
  resolveOutboundDelayRangeMs,
} from './outbound-schedule';

describe('outbound-schedule', () => {
  describe('resolveMaxDailyCalls', () => {
    it('por defecto 35', () => {
      expect(resolveMaxDailyCalls(undefined)).toBe(35);
      expect(resolveMaxDailyCalls(null)).toBe(35);
      expect(resolveMaxDailyCalls('')).toBe(35);
      expect(DEFAULT_MAX_DAILY_CALLS).toBe(35);
    });

    it('lee MAX_DAILY_CALLS numérico', () => {
      expect(resolveMaxDailyCalls('30')).toBe(30);
      expect(resolveMaxDailyCalls(45)).toBe(45);
      expect(resolveMaxDailyCalls('10')).toBe(10);
    });

    it('valores inválidos caen al default', () => {
      expect(resolveMaxDailyCalls('0')).toBe(35);
      expect(resolveMaxDailyCalls('-5')).toBe(35);
      expect(resolveMaxDailyCalls('abc')).toBe(35);
    });
  });

  describe('resolveOutboundDelayRangeMs', () => {
    it('por defecto 5–10 minutos', () => {
      expect(resolveOutboundDelayRangeMs()).toEqual({
        minMs: DEFAULT_OUTBOUND_DELAY_MIN_MS,
        maxMs: DEFAULT_OUTBOUND_DELAY_MAX_MS,
      });
      expect(DEFAULT_OUTBOUND_DELAY_MIN_MS).toBe(5 * 60_000);
      expect(DEFAULT_OUTBOUND_DELAY_MAX_MS).toBe(10 * 60_000);
    });

    it('lee env y ordena si min > max', () => {
      expect(
        resolveOutboundDelayRangeMs({ minRaw: '600000', maxRaw: '300000' }),
      ).toEqual({ minMs: 300_000, maxMs: 600_000 });
    });
  });

  describe('pickOutboundInterCallDelayMs', () => {
    it('queda dentro del rango inclusive', () => {
      const samples = Array.from({ length: 40 }, (_, i) =>
        pickOutboundInterCallDelayMs(300_000, 600_000, () => i / 40),
      );
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(300_000);
        expect(s).toBeLessThanOrEqual(600_000);
      }
    });

    it('si min=max devuelve ese valor', () => {
      expect(pickOutboundInterCallDelayMs(120_000, 120_000)).toBe(120_000);
    });
  });

  describe('isWithinOutboundCallHours (Madrid)', () => {
    const tue = (hour: number, minute = 0) => ({
      weekday: 2,
      hour,
      minute,
    });

    it('permite mañana 10:00–13:59', () => {
      expect(isWithinOutboundCallHours(tue(10, 0))).toBe(true);
      expect(isWithinOutboundCallHours(tue(13, 59))).toBe(true);
    });

    it('bloquea pausa 14:00–16:59', () => {
      expect(isWithinOutboundCallHours(tue(14, 0))).toBe(false);
      expect(isWithinOutboundCallHours(tue(15, 30))).toBe(false);
      expect(isWithinOutboundCallHours(tue(16, 59))).toBe(false);
    });

    it('permite tarde 17:00–20:30', () => {
      expect(isWithinOutboundCallHours(tue(17, 0))).toBe(true);
      expect(isWithinOutboundCallHours(tue(20, 0))).toBe(true);
      expect(isWithinOutboundCallHours(tue(20, 30))).toBe(true);
    });

    it('bloquea fuera de 10:00–20:30 y fines de semana', () => {
      expect(isWithinOutboundCallHours(tue(9, 59))).toBe(false);
      expect(isWithinOutboundCallHours(tue(20, 31))).toBe(false);
      expect(isWithinOutboundCallHours(tue(22, 30))).toBe(false);
      expect(
        isWithinOutboundCallHours({ weekday: 0, hour: 11, minute: 0 }),
      ).toBe(false);
      expect(
        isWithinOutboundCallHours({ weekday: 6, hour: 11, minute: 0 }),
      ).toBe(false);
    });
  });

  describe('alignToOutboundBusinessHours', () => {
    it('antes de las 10 → mismo día 10:00', () => {
      const raw = madridWallToUtc(2026, 11, 3, 9, 15); // martes
      const aligned = alignToOutboundBusinessHours(raw);
      const p = madridOutboundParts(aligned);
      expect(p.hour).toBe(10);
      expect(p.minute).toBe(0);
      expect(p.day).toBe(3);
    });

    it('pausa 14–17 → 17:00', () => {
      const raw = madridWallToUtc(2026, 11, 3, 15, 0);
      const aligned = alignToOutboundBusinessHours(raw);
      const p = madridOutboundParts(aligned);
      expect(p.hour).toBe(17);
      expect(p.minute).toBe(0);
    });

    it('sábado → lunes 10:00', () => {
      const raw = madridWallToUtc(2026, 11, 7, 12, 0); // sábado
      const aligned = alignToOutboundBusinessHours(raw);
      const p = madridOutboundParts(aligned);
      expect(p.weekday).toBe(1);
      expect(p.hour).toBe(10);
      expect(p.day).toBe(9);
    });

    it('dentro de ventana no mueve', () => {
      const raw = madridWallToUtc(2026, 11, 3, 11, 30);
      expect(alignToOutboundBusinessHours(raw).getTime()).toBe(raw.getTime());
    });
  });
});
