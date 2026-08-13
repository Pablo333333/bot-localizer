import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from './phase3-enabled';

describe('isNurturingPhase3Enabled', () => {
  it('por defecto está desactivado', () => {
    expect(isNurturingPhase3Enabled(undefined)).toBe(false);
    expect(isNurturingPhase3Enabled(null)).toBe(false);
    expect(isNurturingPhase3Enabled('')).toBe(false);
    expect(isNurturingPhase3Enabled(false)).toBe(false);
    expect(isNurturingPhase3Enabled('false')).toBe(false);
    expect(isNurturingPhase3Enabled('no')).toBe(false);
  });

  it('solo se activa con true explícito', () => {
    expect(isNurturingPhase3Enabled(true)).toBe(true);
    expect(isNurturingPhase3Enabled('true')).toBe(true);
    expect(isNurturingPhase3Enabled('TRUE')).toBe(true);
    expect(isNurturingPhase3Enabled('1')).toBe(true);
    expect(isNurturingPhase3Enabled('yes')).toBe(true);
  });

  it('expone el log de desactivación', () => {
    expect(NURTURING_PHASE3_DISABLED_LOG).toBe(
      'Phase 3 Nurturing disabled via environment variable',
    );
  });
});
