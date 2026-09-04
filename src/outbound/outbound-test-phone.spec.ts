import {
  matchesOutboundTestPhone,
  phoneDigitsKey,
  resolveOutboundTestPhoneOnly,
} from './outbound-test-phone';

describe('outbound-test-phone', () => {
  it('resolveOutboundTestPhoneOnly: vacío/ausente → null', () => {
    expect(resolveOutboundTestPhoneOnly(undefined)).toBeNull();
    expect(resolveOutboundTestPhoneOnly(null)).toBeNull();
    expect(resolveOutboundTestPhoneOnly('')).toBeNull();
    expect(resolveOutboundTestPhoneOnly('   ')).toBeNull();
    expect(resolveOutboundTestPhoneOnly('+34644408099')).toBe('+34644408099');
  });

  it('phoneDigitsKey elimina no-dígitos', () => {
    expect(phoneDigitsKey('+34 644 408 099')).toBe('34644408099');
  });

  it('matchesOutboundTestPhone: E.164 vs local', () => {
    expect(matchesOutboundTestPhone('+34644408099', '644408099')).toBe(true);
    expect(matchesOutboundTestPhone('644408099', '+34644408099')).toBe(true);
    expect(matchesOutboundTestPhone('+34644408099', '+34644408099')).toBe(
      true,
    );
    expect(matchesOutboundTestPhone('+34611111111', '+34644408099')).toBe(
      false,
    );
  });
});
