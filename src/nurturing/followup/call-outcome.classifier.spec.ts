import { CallOutcomeClassifier } from './call-outcome.classifier';
import { CallOutcome } from '../enums';

describe('CallOutcomeClassifier', () => {
  const classifier = new CallOutcomeClassifier();

  it('clasifica NO_ANSWER, BUSY, VOICEMAIL y HANGUP (no cerrado)', () => {
    expect(
      classifier.classify({ disconnection_reason: 'dial_no_answer' }),
    ).toBe(CallOutcome.NO_ANSWER);
    expect(classifier.classify({ disconnection_reason: 'dial_busy' })).toBe(
      CallOutcome.BUSY,
    );
    expect(
      classifier.classify({ disconnection_reason: 'voicemail_reached' }),
    ).toBe(CallOutcome.VOICEMAIL);
    expect(
      classifier.classify({
        disconnection_reason: 'user_hangup',
        duration_ms: 4000,
      }),
    ).toBe(CallOutcome.HANGUP);
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.HANGUP)).toBe(true);
  });

  it('user_hangup de 24s con Session Outcome Successful → HANGUP + WA (no ANSWERED_SUCCESS)', () => {
    const outcome = classifier.classify({
      call_id: 'call_5df14bab027f2c5a803053f0b6b',
      disconnection_reason: 'user_hangup',
      duration_ms: 24_000,
      call_analysis: { call_successful: true, call_summary: 'Brief call' },
    });
    expect(outcome).toBe(CallOutcome.HANGUP);
    expect(classifier.shouldSendBookingWhatsApp(outcome)).toBe(true);
    expect(classifier.shouldMarkClosed(outcome)).toBe(false);
  });

  it('user hangup (con espacio) también se reconoce', () => {
    expect(
      classifier.classify({ disconnection_reason: 'user hangup' }),
    ).toBe(CallOutcome.HANGUP);
  });

  it('call_ended: user_hangup es nurturing temprano', () => {
    expect(
      classifier.isClearNoContactBeforeAnalysis({
        disconnection_reason: 'user_hangup',
        duration_ms: 24_000,
      }),
    ).toBe(true);
  });

  it('solo rechazo explícito en conversación → cerrado', () => {
    expect(
      classifier.classify({
        call_analysis: { call_summary: 'Dice que no le interesa' },
      }),
    ).toBe(CallOutcome.EXPLICIT_REJECTION);
  });
});
