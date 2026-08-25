import { isOutboundCallsEnabled } from './outbound-enabled';

describe('isOutboundCallsEnabled', () => {
  it('usa OUTBOUND_CALLS_ENABLED si está definido', () => {
    expect(
      isOutboundCallsEnabled({
        outboundCallsEnabled: 'true',
        nurturingPhase3Enabled: 'false',
      }),
    ).toBe(true);
    expect(
      isOutboundCallsEnabled({
        outboundCallsEnabled: 'false',
        nurturingPhase3Enabled: 'true',
      }),
    ).toBe(false);
  });

  it('hereda NURTURING_PHASE3_ENABLED si outbound no está definido', () => {
    expect(
      isOutboundCallsEnabled({
        outboundCallsEnabled: undefined,
        nurturingPhase3Enabled: 'true',
      }),
    ).toBe(true);
    expect(
      isOutboundCallsEnabled({
        outboundCallsEnabled: '',
        nurturingPhase3Enabled: 'false',
      }),
    ).toBe(false);
  });
});
