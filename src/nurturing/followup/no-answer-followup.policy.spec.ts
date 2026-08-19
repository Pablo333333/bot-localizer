import { planNoContactFollowup } from './no-answer-followup.policy';

describe('planNoContactFollowup', () => {
  it('T+0: solo WhatsApp (sin SMS) y enroll de T+7/T+10', () => {
    expect(planNoContactFollowup('t0')).toEqual({
      sendWhatsApp: true,
      sendSms: false,
      enroll: true,
      markIlocalizable: false,
    });
  });

  it('T+7: SMS de seguimiento con enlace de cita; no WhatsApp', () => {
    expect(planNoContactFollowup('t7')).toEqual({
      sendWhatsApp: false,
      sendSms: true,
      enroll: false,
      markIlocalizable: false,
    });
  });

  it('T+10: marca ilocalizable y no envía WA/SMS', () => {
    expect(planNoContactFollowup('t10')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      markIlocalizable: true,
    });
  });

  it('fase unknown: no dispara canales ni ilocalizable', () => {
    expect(planNoContactFollowup('unknown')).toEqual({
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      markIlocalizable: false,
    });
  });
});
