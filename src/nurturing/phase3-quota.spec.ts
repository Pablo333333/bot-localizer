import {
  madridDateKey,
  madridStartOfDay,
} from '../outbound/outbound-schedule';
import {
  DEFAULT_MAX_DAILY_PHASE3_LEADS,
  remainingPhase3DailyQuota,
  resolveMaxDailyPhase3Leads,
} from './phase3-quota';

describe('phase3-quota', () => {
  it('default 30 independiente de Fase 1', () => {
    expect(DEFAULT_MAX_DAILY_PHASE3_LEADS).toBe(30);
    expect(resolveMaxDailyPhase3Leads(undefined)).toBe(30);
    expect(resolveMaxDailyPhase3Leads('')).toBe(30);
  });

  it('lee MAX_DAILY_PHASE3_LEADS', () => {
    expect(resolveMaxDailyPhase3Leads('30')).toBe(30);
    expect(resolveMaxDailyPhase3Leads(15)).toBe(15);
  });

  it('valores inválidos → default', () => {
    expect(resolveMaxDailyPhase3Leads('0')).toBe(30);
    expect(resolveMaxDailyPhase3Leads(-2)).toBe(30);
    expect(resolveMaxDailyPhase3Leads('abc')).toBe(30);
  });

  it('remaining no baja de 0', () => {
    expect(remainingPhase3DailyQuota({ usedToday: 10, maxDaily: 30 })).toBe(20);
    expect(remainingPhase3DailyQuota({ usedToday: 30, maxDaily: 30 })).toBe(0);
    expect(remainingPhase3DailyQuota({ usedToday: 40, maxDaily: 30 })).toBe(0);
  });

  it('reinicio diario Madrid: jueves no solapa con viernes', () => {
    // 11 Nov 2026 = miércoles → jueves 12 / viernes 13. Cron 10:05 Madrid = 09:05 UTC (CET).
    const thursdayCron = new Date('2026-11-12T09:05:00.000Z');
    const fridayMorning = new Date('2026-11-13T09:05:00.000Z');

    expect(madridDateKey(thursdayCron)).toBe('2026-11-12');
    expect(madridDateKey(fridayMorning)).toBe('2026-11-13');

    const thursdayStart = madridStartOfDay(thursdayCron).getTime();
    const fridayStart = madridStartOfDay(fridayMorning).getTime();
    expect(fridayStart).toBeGreaterThan(thursdayStart);

    // Un enroll del jueves 10:05 queda fuera del filtro enrolledAt >= viernes 00:00.
    const thursdayEnrollAt = thursdayCron.getTime();
    expect(thursdayEnrollAt).toBeGreaterThanOrEqual(thursdayStart);
    expect(thursdayEnrollAt).toBeLessThan(fridayStart);

    // Cupo viernes parte de 0 usados → remaining = 30.
    expect(
      remainingPhase3DailyQuota({ usedToday: 0, maxDaily: 30 }),
    ).toBe(30);
    expect(
      remainingPhase3DailyQuota({ usedToday: 30, maxDaily: 30 }),
    ).toBe(0);
  });
});
