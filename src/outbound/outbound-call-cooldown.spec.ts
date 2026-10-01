import {
  CALL_COOLDOWN_MS,
  isWithinCallCooldown,
  latestAttemptTimestamp,
} from './outbound-call-cooldown';

describe('cooldown de llamadas (48h)', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('exige un mínimo de 48 horas', () => {
    expect(CALL_COOLDOWN_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('bloquea intentos de ayer y anteayer', () => {
    const yesterday = now - 24 * 60 * 60 * 1000;
    const dayBefore = now - 40 * 60 * 60 * 1000;
    expect(isWithinCallCooldown(yesterday, now)).toBe(true);
    expect(isWithinCallCooldown(dayBefore, now)).toBe(true);
  });

  it('deja pasar un intento anterior a 48 horas', () => {
    const older = now - 48 * 60 * 60 * 1000 - 1000;
    expect(isWithinCallCooldown(older, now)).toBe(false);
  });

  it('usa la fecha de intento o llamada más reciente', () => {
    const attempt = now - 10 * 60 * 60 * 1000;
    const completed = now - 30 * 60 * 60 * 1000;
    expect(latestAttemptTimestamp([completed, null, attempt])).toBe(attempt);
    expect(latestAttemptTimestamp([null, undefined])).toBeNull();
  });
});
