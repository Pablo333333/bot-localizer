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
});
