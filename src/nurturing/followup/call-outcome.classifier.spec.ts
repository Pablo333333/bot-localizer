import { CallOutcomeClassifier } from './call-outcome.classifier';
import { CallOutcome } from '../enums';

describe('CallOutcomeClassifier', () => {
  const classifier = new CallOutcomeClassifier();

  it('clasifica NO_ANSWER, BUSY, VOICEMAIL y HANGUP largo', () => {
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
        duration_ms: 24_000,
      }),
    ).toBe(CallOutcome.HANGUP);
  });

  it('hangup corto (<8s) sin éxito → NO_ANSWER (enroll)', () => {
    expect(
      classifier.classify({
        disconnection_reason: 'user_hangup',
        duration_ms: 4000,
      }),
    ).toBe(CallOutcome.NO_ANSWER);
    expect(
      classifier.shouldEnrollRetrySequence(CallOutcome.NO_ANSWER),
    ).toBe(true);
  });

  it('NO_ANSWER enrolla; HANGUP solo PENDIENTE sin enroll', () => {
    expect(classifier.shouldEnrollRetrySequence(CallOutcome.NO_ANSWER)).toBe(
      true,
    );
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.NO_ANSWER)).toBe(
      true,
    );
    expect(classifier.shouldEnrollRetrySequence(CallOutcome.HANGUP)).toBe(
      false,
    );
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.HANGUP)).toBe(
      false,
    );
    expect(classifier.shouldMarkPendiente(CallOutcome.HANGUP)).toBe(true);
    expect(classifier.shouldMarkPendiente(CallOutcome.NO_ANSWER)).toBe(true);
  });

  it('user_hangup con Session Outcome Successful → HANGUP sin enroll', () => {
    const outcome = classifier.classify({
      call_id: 'call_5df14bab027f2c5a803053f0b6b',
      disconnection_reason: 'user_hangup',
      duration_ms: 24_000,
      call_analysis: { call_successful: true, call_summary: 'Brief call' },
    });
    expect(outcome).toBe(CallOutcome.HANGUP);
    expect(classifier.shouldEnrollRetrySequence(outcome)).toBe(false);
    expect(classifier.shouldMarkPendiente(outcome)).toBe(true);
    expect(classifier.shouldMarkClosed(outcome)).toBe(false);
  });

  it('posponer en summary/estado → POSTPONE + enroll', () => {
    expect(
      classifier.classify({
        call_analysis: {
          call_summary: 'Dice que le llamemos más tarde',
          custom_analysis_data: { estado: 'posponer' },
        },
      }),
    ).toBe(CallOutcome.POSTPONE);
    expect(classifier.shouldEnrollRetrySequence(CallOutcome.POSTPONE)).toBe(
      true,
    );
  });

  it('user hangup (con espacio) corto → NO_ANSWER', () => {
    expect(
      classifier.classify({
        disconnection_reason: 'user hangup',
        duration_ms: 2000,
      }),
    ).toBe(CallOutcome.NO_ANSWER);
  });

  it('user hangup largo sin duration explícita → HANGUP', () => {
    expect(
      classifier.classify({ disconnection_reason: 'user hangup' }),
    ).toBe(CallOutcome.HANGUP);
  });

  it('call_ended: user_hangup es nurturing temprano (PENDIENTE)', () => {
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
