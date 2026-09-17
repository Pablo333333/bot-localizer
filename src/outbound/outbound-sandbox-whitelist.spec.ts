import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
  guardOutboundRetellCall,
  isAllowedOutboundSandboxPhone,
  isOutboundSandboxWhitelistEnabled,
  safeCreatePhoneCall,
} from './outbound-sandbox-whitelist';

describe('outbound sandbox whitelist', () => {
  const prev = process.env.OUTBOUND_SANDBOX_WHITELIST_ENABLED;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OUTBOUND_SANDBOX_WHITELIST_ENABLED;
    } else {
      process.env.OUTBOUND_SANDBOX_WHITELIST_ENABLED = prev;
    }
  });

  it('producción: whitelist OFF — lote Fase 1 a números reales', () => {
    delete process.env.OUTBOUND_SANDBOX_WHITELIST_ENABLED;
    expect(OUTBOUND_SANDBOX_WHITELIST_ENABLED).toBe(false);
    expect(isOutboundSandboxWhitelistEnabled()).toBe(false);
    expect(OUTBOUND_SANDBOX_WHITELIST_E164).toBe('+34644408099');
  });

  it('env true activa sandbox; env false lo desactiva', () => {
    expect(isOutboundSandboxWhitelistEnabled('true')).toBe(true);
    expect(isOutboundSandboxWhitelistEnabled('false')).toBe(false);
    expect(isAllowedOutboundSandboxPhone('+34611111111', 'true')).toBe(false);
    expect(isAllowedOutboundSandboxPhone('+34644408099', 'true')).toBe(true);
  });

  it('con sandbox off permite cualquier número (incl. no-Toni)', () => {
    expect(isAllowedOutboundSandboxPhone('+34611111111')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('+34971122334')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('+34644408099')).toBe(true);
    expect(guardOutboundRetellCall('+34600000000')).toEqual({ allowed: true });
  });

  it('safeCreatePhoneCall dispara Retell a números reales cuando el sandbox está off', async () => {
    const createPhoneCall = jest.fn().mockResolvedValue({ call_id: 'call_ok' });
    const retell = { call: { createPhoneCall } };

    const result = await safeCreatePhoneCall(retell, {
      from_number: '+34871075112',
      to_number: '+34611111111',
      override_agent_id: 'agent_test',
    });

    expect(result).toEqual({ skipped: false, call: { call_id: 'call_ok' } });
    expect(createPhoneCall).toHaveBeenCalledTimes(1);
    expect(createPhoneCall.mock.calls[0][0].to_number).toBe('+34611111111');
  });
});
