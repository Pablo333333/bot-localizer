import {
  DEFAULT_MAX_DAILY_CALLS,
  isWithinOutboundCallHours,
  resolveMaxDailyCalls,
} from './outbound-schedule';

describe('outbound-schedule', () => {
  describe('resolveMaxDailyCalls', () => {
    it('por defecto 30', () => {
      expect(resolveMaxDailyCalls(undefined)).toBe(30);
      expect(resolveMaxDailyCalls(null)).toBe(30);
      expect(resolveMaxDailyCalls('')).toBe(30);
      expect(DEFAULT_MAX_DAILY_CALLS).toBe(30);
    });

    it('lee MAX_DAILY_CALLS numérico', () => {
      expect(resolveMaxDailyCalls('30')).toBe(30);
      expect(resolveMaxDailyCalls(45)).toBe(45);
      expect(resolveMaxDailyCalls('10')).toBe(10);
    });

    it('valores inválidos caen al default', () => {
      expect(resolveMaxDailyCalls('0')).toBe(30);
      expect(resolveMaxDailyCalls('-5')).toBe(30);
      expect(resolveMaxDailyCalls('abc')).toBe(30);
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
      expect(isWithinOutboundCallHours(tue(20, 30))).toBe(true);
    });

    it('bloquea fuera de 10:00–20:30 y fines de semana', () => {
      expect(isWithinOutboundCallHours(tue(9, 59))).toBe(false);
      expect(isWithinOutboundCallHours(tue(20, 31))).toBe(false);
      expect(
        isWithinOutboundCallHours({ weekday: 0, hour: 11, minute: 0 }),
      ).toBe(false);
      expect(
        isWithinOutboundCallHours({ weekday: 6, hour: 11, minute: 0 }),
      ).toBe(false);
    });
  });
});
