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
    expect(classifier.shouldMarkClosed(CallOutcome.NO_ANSWER)).toBe(false);
    expect(classifier.shouldMarkClosed(CallOutcome.HANGUP)).toBe(false);
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.NO_ANSWER)).toBe(
      true,
    );
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.HANGUP)).toBe(true);
    expect(classifier.shouldSendBookingWhatsApp(CallOutcome.BUSY)).toBe(true);
  });

  it('user_hangup con duración 0 / canceled / user_declined → nurturing', () => {
    expect(
      classifier.classify({
        disconnection_reason: 'user_hangup',
        duration_ms: 0,
      }),
    ).toBe(CallOutcome.HANGUP);
    expect(
      classifier.classify({ disconnection_reason: 'canceled' }),
    ).toBe(CallOutcome.NO_ANSWER);
    expect(
      classifier.classify({ disconnection_reason: 'user_declined' }),
    ).toBe(CallOutcome.NO_ANSWER);
    expect(
      classifier.classify({
        call_status: 'not_connected',
        disconnection_reason: 'dial_failed',
      }),
    ).toBe(CallOutcome.NO_ANSWER);
  });

  it('dispara WhatsApp para no-answer, busy, hangup y voicemail', () => {
    for (const outcome of [
      CallOutcome.NO_ANSWER,
      CallOutcome.BUSY,
      CallOutcome.HANGUP,
      CallOutcome.VOICEMAIL,
    ]) {
      expect(classifier.shouldSendBookingWhatsApp(outcome)).toBe(true);
    }
    expect(
      classifier.shouldSendBookingWhatsApp(CallOutcome.ANSWERED_SUCCESS),
    ).toBe(false);
  });

  it('isClearNoContactBeforeAnalysis: dial_* / declined / not_connected', () => {
    expect(
      classifier.isClearNoContactBeforeAnalysis({
        disconnection_reason: 'dial_no_answer',
      }),
    ).toBe(true);
    expect(
      classifier.isClearNoContactBeforeAnalysis({
        disconnection_reason: 'user_declined',
      }),
    ).toBe(true);
    expect(
      classifier.isClearNoContactBeforeAnalysis({
        call_status: 'not_connected',
      }),
    ).toBe(true);
    expect(
      classifier.isClearNoContactBeforeAnalysis({
        disconnection_reason: 'user_hangup',
        duration_ms: 30_000,
      }),
    ).toBe(false);
  });
});
