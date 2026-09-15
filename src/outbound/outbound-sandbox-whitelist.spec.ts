import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
  guardOutboundRetellCall,
  isAllowedOutboundSandboxPhone,
  safeCreatePhoneCall,
} from './outbound-sandbox-whitelist';

describe('outbound sandbox whitelist', () => {
  it('PRUEBA: whitelist ACTIVA — solo Toni (+34644408099)', () => {
    expect(OUTBOUND_SANDBOX_WHITELIST_ENABLED).toBe(true);
    expect(OUTBOUND_SANDBOX_WHITELIST_E164).toBe('+34644408099');
  });

  it('permite solo el número de Toni (variantes de formato)', () => {
    expect(isAllowedOutboundSandboxPhone('+34644408099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('+34 644 408 099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('644408099')).toBe(true);
    expect(isAllowedOutboundSandboxPhone('34644408099')).toBe(true);
  });

  it('bloquea cualquier otro lead', () => {
    expect(isAllowedOutboundSandboxPhone('+34611111111')).toBe(false);
    expect(isAllowedOutboundSandboxPhone('+34971122334')).toBe(false);
    expect(guardOutboundRetellCall('+34600000000')).toEqual({
      allowed: false,
      skipCode: 'skipped_sandbox_whitelist',
    });
  });

  it('safeCreatePhoneCall NO dispara Retell a números fuera de whitelist', async () => {
    const createPhoneCall = jest.fn().mockResolvedValue({ call_id: 'call_ok' });
    const retell = { call: { createPhoneCall } };

    const blocked = await safeCreatePhoneCall(retell, {
      from_number: '+34871075112',
      to_number: '+34611111111',
      override_agent_id: 'agent_test',
    });
    expect(blocked).toEqual({
      skipped: true,
      skipCode: 'skipped_sandbox_whitelist',
    });
    expect(createPhoneCall).not.toHaveBeenCalled();

    const allowed = await safeCreatePhoneCall(retell, {
      from_number: '+34871075112',
      to_number: '+34644408099',
      override_agent_id: 'agent_test',
    });
    expect(allowed).toEqual({ skipped: false, call: { call_id: 'call_ok' } });
    expect(createPhoneCall).toHaveBeenCalledTimes(1);
  });
});
