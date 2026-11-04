import {
  PAUSE_ALL_AUTOMATIONS_LOG,
  isPauseAllAutomations,
} from './pause-automations';

describe('isPauseAllAutomations', () => {
  it('acepta true/1/yes/si', () => {
    expect(isPauseAllAutomations('true')).toBe(true);
    expect(isPauseAllAutomations('1')).toBe(true);
    expect(isPauseAllAutomations('yes')).toBe(true);
    expect(isPauseAllAutomations('si')).toBe(true);
    expect(isPauseAllAutomations(true)).toBe(true);
  });

  it('rechaza vacío/false', () => {
    expect(isPauseAllAutomations(undefined)).toBe(false);
    expect(isPauseAllAutomations('')).toBe(false);
    expect(isPauseAllAutomations('false')).toBe(false);
    expect(isPauseAllAutomations(false)).toBe(false);
  });

  it('expone mensaje operativo', () => {
    expect(PAUSE_ALL_AUTOMATIONS_LOG).toContain('PAUSE_ALL_AUTOMATIONS');
  });
});
