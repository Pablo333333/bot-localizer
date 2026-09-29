import {
  NURTURING_FAST_T10_MINUTES_DEFAULT,
  NURTURING_FAST_T7_MINUTES_DEFAULT,
  isNurturingFastTest,
  resolveNurturingStepDelayMinutes,
} from './nurturing-fast-delay';
import {
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
} from './toni-fase3.constants';

describe('nurturing fast delay', () => {
  it('fast test off conserva los días de la secuencia', () => {
    expect(isNurturingFastTest(undefined)).toBe(false);
    expect(isNurturingFastTest('false')).toBe(false);
    expect(
      resolveNurturingStepDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
        storedDelayMinutes: 10_080,
        fastTestRaw: 'false',
      }),
    ).toBe(10_080);
  });

  it('fast test comprime T+7 a 3 min y T+10 a 5 min', () => {
    expect(isNurturingFastTest('true')).toBe(true);
    expect(
      resolveNurturingStepDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
        storedDelayMinutes: 10_080,
        fastTestRaw: 'true',
      }),
    ).toBe(NURTURING_FAST_T7_MINUTES_DEFAULT);
    expect(
      resolveNurturingStepDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D10,
        storedDelayMinutes: 14_400,
        fastTestRaw: true,
      }),
    ).toBe(NURTURING_FAST_T10_MINUTES_DEFAULT);
  });

  it('permite override por env', () => {
    expect(
      resolveNurturingStepDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
        storedDelayMinutes: 10_080,
        fastTestRaw: '1',
        fastT7MinutesRaw: '8',
      }),
    ).toBe(8);
    expect(
      resolveNurturingStepDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D10,
        storedDelayMinutes: 14_400,
        fastTestRaw: 'yes',
        fastT10MinutesRaw: '12',
      }),
    ).toBe(12);
  });
});
