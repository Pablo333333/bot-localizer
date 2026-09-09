import {
  OUTBOUND_AUTO_DIAL_PAUSED,
  describeOutboundMode,
  isOutboundCallsEnabled,
} from './outbound-enabled';

describe('OUTBOUND_AUTO_DIAL_PAUSED', () => {
  it('está desactivada: el lote Fase 1 puede disparar según horario y cupo', () => {
    expect(OUTBOUND_AUTO_DIAL_PAUSED).toBe(false);
  });
});

describe('isOutboundCallsEnabled', () => {
  it('usa OUTBOUND_CALLS_ENABLED si está definido (independiente de Fase 3)', () => {
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

describe('describeOutboundMode', () => {
  it('lote Fase 1 masivo: outbound on + Fase 3 off + sin filtro Toni', () => {
    const mode = describeOutboundMode({
      outboundCallsEnabled: 'true',
      nurturingPhase3Enabled: 'false',
      testPhoneOnly: null,
      maxDailyCalls: 30,
    });
    expect(mode).toEqual({
      outboundEnabled: true,
      phase3NurturingEnabled: false,
      phase1MassBatch: true,
      testFilterActive: false,
      maxDailyCalls: 30,
    });
  });

  it('filtro Toni no es lote masivo', () => {
    const mode = describeOutboundMode({
      outboundCallsEnabled: 'true',
      nurturingPhase3Enabled: 'false',
      testPhoneOnly: '+34644408099',
      maxDailyCalls: 30,
    });
    expect(mode.phase1MassBatch).toBe(false);
    expect(mode.testFilterActive).toBe(true);
  });
});
