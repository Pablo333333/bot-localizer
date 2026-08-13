import { CallOutcomeClassifier } from './call-outcome.classifier';
import { CallOutcome } from '../enums';

describe('CallOutcomeClassifier', () => {
  const classifier = new CallOutcomeClassifier();

  it('clasifica NO_ANSWER y HANGUP (no cerrado)', () => {
    expect(
      classifier.classify({ disconnection_reason: 'dial_no_answer' }),
    ).toBe(CallOutcome.NO_ANSWER);
    expect(
      classifier.classify({
        disconnection_reason: 'user_hangup',
        duration_ms: 4000,
      }),
    ).toBe(CallOutcome.HANGUP);
    expect(classifier.shouldMarkClosed(CallOutcome.NO_ANSWER)).toBe(false);
    expect(classifier.shouldMarkClosed(CallOutcome.HANGUP)).toBe(false);
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.NO_ANSWER)).toBe(
      true,
    );
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.HANGUP)).toBe(true);
  });

  it('solo rechazo explícito → cerrado', () => {
    expect(
      classifier.classify({
        call_analysis: { call_summary: 'Dice que no le interesa' },
      }),
    ).toBe(CallOutcome.EXPLICIT_REJECTION);
    expect(classifier.shouldMarkClosed(CallOutcome.EXPLICIT_REJECTION)).toBe(
      true,
    );
  });
});
