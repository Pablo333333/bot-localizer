import { CallOutcome } from '../enums';
import {
  planNoContactFollowup,
  planToniSequence,
  resolveT0MessageChannel,
} from './no-answer-followup.policy';

describe('resolveT0MessageChannel', () => {
  it('default → sms (WA business aún sin plantilla aprobada)', () => {
    expect(resolveT0MessageChannel(undefined)).toBe('sms');
    expect(resolveT0MessageChannel(null)).toBe('sms');
    expect(resolveT0MessageChannel('')).toBe('sms');
  });

  it('acepta whatsapp / both', () => {
    expect(resolveT0MessageChannel('whatsapp')).toBe('whatsapp');
    expect(resolveT0MessageChannel('wa')).toBe('whatsapp');
    expect(resolveT0MessageChannel('both')).toBe('both');
  });
});

describe('planNoContactFollowup', () => {
  it('T+0 sin enroll=true → no WA ni cola', () => {
    expect(planNoContactFollowup('t0')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+0 con enroll=true (default sms): SMS y enroll T+7/T+10', () => {
    expect(planNoContactFollowup('t0', { enroll: true })).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+0 enroll + whatsapp channel', () => {
    expect(
      planNoContactFollowup('t0', {
        enroll: true,
        t0Channel: resolveT0MessageChannel('whatsapp'),
      }),
    ).toEqual({
      sendWhatsApp: true,
      sendSms: false,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+0 enroll + both', () => {
    expect(
      planNoContactFollowup('t0', { enroll: true, t0Channel: 'both' }),
    ).toEqual({
      sendWhatsApp: true,
      sendSms: true,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+0 hangup bookingFallback → SMS y programa la llamada 2', () => {
    expect(
      planNoContactFollowup('t0', { bookingFallback: true }),
    ).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+0 hangup + whatsapp: WA y enroll', () => {
    expect(
      planNoContactFollowup('t0', {
        bookingFallback: true,
        t0Channel: 'whatsapp',
      }),
    ).toEqual({
      sendWhatsApp: true,
      sendSms: false,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+7: SMS de seguimiento y encola llamada 3', () => {
    expect(planNoContactFollowup('t7')).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: false,
      scheduleNextCall: true,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('T+10: marca ilocalizable y termina', () => {
    expect(planNoContactFollowup('t10')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      scheduleNextCall: false,
      markIlocalizable: true,
      endSequence: true,
    });
  });
});

describe('planToniSequence', () => {
  it('llamada 1: contesta y cuelga → WhatsApp y programa la llamada 2', () => {
    expect(planToniSequence('t0', CallOutcome.HANGUP)).toEqual({
      sendWhatsApp: true,
      sendSms: false,
      enroll: true,
      scheduleNextCall: false,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('llamada 2: contesta y cuelga → SMS y programa la llamada 3', () => {
    expect(planToniSequence('t7', CallOutcome.HANGUP)).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: false,
      scheduleNextCall: true,
      markIlocalizable: false,
      endSequence: false,
    });
  });

  it('llamada 2 no contesta: también SMS y llama 3', () => {
    expect(planToniSequence('t7', CallOutcome.NO_ANSWER).scheduleNextCall).toBe(
      true,
    );
    expect(planToniSequence('t7', CallOutcome.NO_ANSWER).sendSms).toBe(true);
  });

  it('llamada 3 no contesta → ILOCALIZABLE y fin', () => {
    expect(planToniSequence('t10', CallOutcome.NO_ANSWER)).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      scheduleNextCall: false,
      markIlocalizable: true,
      endSequence: true,
    });
  });

  it('llamada 3 cuelgue no cierra como ilocalizable', () => {
    expect(planToniSequence('t10', CallOutcome.HANGUP)).toMatchObject({
      markIlocalizable: false,
      endSequence: false,
    });
  });
});
