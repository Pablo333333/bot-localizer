import type { NurturingCallPhase } from '../toni-fase3.constants';

export interface NoContactFollowupPlan {
  sendWhatsApp: boolean;
  sendSms: boolean;
  enroll: boolean;
  markIlocalizable: boolean;
}

/**
 * Acciones de seguimiento cuando la llamada no contacta (NO_ANSWER / HANGUP / etc.).
 * T+0: solo WhatsApp + enroll. T+7: SMS. T+10: ilocalizable.
 */
export function planNoContactFollowup(
  phase: NurturingCallPhase,
): NoContactFollowupPlan {
  switch (phase) {
    case 't0':
      return {
        sendWhatsApp: true,
        sendSms: false,
        enroll: true,
        markIlocalizable: false,
      };
    case 't7':
      return {
        sendWhatsApp: false,
        sendSms: true,
        enroll: false,
        markIlocalizable: false,
      };
    case 't10':
      return {
        sendWhatsApp: false,
        sendSms: false,
        enroll: false,
        markIlocalizable: true,
      };
    default:
      return {
        sendWhatsApp: false,
        sendSms: false,
        enroll: false,
        markIlocalizable: false,
      };
  }
}
