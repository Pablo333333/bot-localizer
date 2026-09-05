import {
  planNoContactFollowup,
  resolveT0MessageChannel,
} from './no-answer-followup.policy';

describe('planNoContactFollowup', () => {
  it('T+0 sin enroll=true → no WA ni cola', () => {
    expect(planNoContactFollowup('t0')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      markIlocalizable: false,
    });
  });

  it('T+0 con enroll=true: WhatsApp y enroll T+7/T+10', () => {
    expect(planNoContactFollowup('t0', { enroll: true })).toEqual({
      sendWhatsApp: true,
      sendSms: false,
      enroll: true,
      markIlocalizable: false,
    });
  });

  it('T+0 enroll + sms channel', () => {
    expect(
      planNoContactFollowup('t0', {
        enroll: true,
        t0Channel: resolveT0MessageChannel('sms'),
      }),
    ).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: true,
      markIlocalizable: false,
    });
  });

  it('T+0 enroll + both', () => {
    expect(
      planNoContactFollowup('t0', { enroll: true, t0Channel: 'both' }),
    ).toEqual({
      sendWhatsApp: true,
      sendSms: true,
      enroll: true,
      markIlocalizable: false,
    });
  });

  it('T+7: SMS de seguimiento; no WhatsApp', () => {
    expect(planNoContactFollowup('t7')).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: false,
      markIlocalizable: false,
    });
  });

  it('T+10: marca ilocalizable', () => {
    expect(planNoContactFollowup('t10')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      markIlocalizable: true,
    });
  });
});
