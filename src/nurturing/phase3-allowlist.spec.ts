import {
  PHASE3_TONI_PHONE_E164,
  isPhase3AllowedPhone,
  resolvePhase3PhoneAllowlist,
} from './phase3-allowlist';

describe('phase3-allowlist', () => {
  it('por defecto solo Toni', () => {
    expect(resolvePhase3PhoneAllowlist(undefined)).toEqual([
      PHASE3_TONI_PHONE_E164,
    ]);
    expect(isPhase3AllowedPhone('+34644408099')).toBe(true);
    expect(isPhase3AllowedPhone('644408099')).toBe(true);
    expect(isPhase3AllowedPhone('+34 644 408 099')).toBe(true);
  });

  it('bloquea cualquier otro lead', () => {
    expect(isPhase3AllowedPhone('+34611111111')).toBe(false);
    expect(isPhase3AllowedPhone('+34971122334')).toBe(false);
    expect(isPhase3AllowedPhone('')).toBe(false);
    expect(isPhase3AllowedPhone(null)).toBe(false);
  });

  it('respeta allowlist env extra', () => {
    expect(
      isPhase3AllowedPhone('+34611111111', '+34644408099,+34611111111'),
    ).toBe(true);
  });
});
