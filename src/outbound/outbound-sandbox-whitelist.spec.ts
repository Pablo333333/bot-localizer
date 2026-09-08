import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
  SKIPPED_SANDBOX_WHITELIST,
  guardOutboundRetellCall,
  isAllowedOutboundSandboxPhone,
  safeCreatePhoneCall,
} from './outbound-sandbox-whitelist';

describe('outbound sandbox whitelist', () => {
  it('está activa en código (pruebas)', () => {
    expect(OUTBOUND_SANDBOX_WHITELIST_ENABLED).toBe(true);
    expect(OUTBOUND_SANDBOX_WHITELIST_E164).toBe('+34644408099');
  });

  it('acepta el número de Toni en cualquier formato', () => {
    expect(isAllowedOutboundSandboxPhone('+34644408099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('+34 644 408 099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('644408099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('34644408099')).toBe(true);
  });

  it('rechaza cualquier otro lead de Sheets/DB', () => {
    expect(isAllowedOutboundSandboxPhone('+34611111111')).toBe(false);
    expect(isAllowedOutboundSandboxPhone('+34971122334')).toBe(false);
    expect(isAllowedOutboundSandboxPhone('')).toBe(false);
    expect(guardOutboundRetellCall('+34600000000')).toEqual({
      allowed: false,
      skipCode: SKIPPED_SANDBOX_WHITELIST,
    });
  });

  it('safeCreatePhoneCall no invoca Retell fuera de whitelist', async () => {
    const createPhoneCall = jest.fn();
    const retell = { call: { createPhoneCall } };

    const result = await safeCreatePhoneCall(
      retell,
      {
        from_number: '+34871075112',
        to_number: '+34611111111',
        override_agent_id: 'agent_test',
      },
    );

    expect(result).toEqual({
      skipped: true,
      skipCode: SKIPPED_SANDBOX_WHITELIST,
    });
    expect(createPhoneCall).not.toHaveBeenCalled();
  });

  it('safeCreatePhoneCall sí dispara Retell al número de prueba', async () => {
    const createPhoneCall = jest.fn().mockResolvedValue({ call_id: 'call_ok' });
    const retell = { call: { createPhoneCall } };

    const result = await safeCreatePhoneCall(
      retell,
      {
        from_number: '+34871075112',
        to_number: '+34 644 408 099',
        override_agent_id: 'agent_test',
      },
    );

    expect(result).toEqual({ skipped: false, call: { call_id: 'call_ok' } });
    expect(createPhoneCall).toHaveBeenCalledTimes(1);
    expect(createPhoneCall.mock.calls[0][0].to_number).toBe('+34 644 408 099');
  });
});
