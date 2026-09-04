import type { NurturingCallPhase } from '../toni-fase3.constants';

export interface NoContactFollowupPlan {
  sendWhatsApp: boolean;
  sendSms: boolean;
  enroll: boolean;
  markIlocalizable: boolean;
}

/** Canal T+0: whatsapp (default) | sms (prueba sin plantilla WA) | both */
export type T0MessageChannel = 'whatsapp' | 'sms' | 'both';

export function resolveT0MessageChannel(
  raw?: string | null,
): T0MessageChannel {
  const v = String(raw ?? 'whatsapp')
    .trim()
    .toLowerCase();
  if (v === 'sms') return 'sms';
  if (v === 'both' || v === 'whatsapp+sms' || v === 'wa+sms') return 'both';
  return 'whatsapp';
}

/**
 * Acciones de seguimiento cuando la llamada no contacta (NO_ANSWER / HANGUP / etc.).
 * T+0: mensaje + enroll. T+7: SMS. T+10: ilocalizable.
 * `t0Channel` permite forzar SMS en pruebas sin plantilla WhatsApp aprobada.
 */
export function planNoContactFollowup(
  phase: NurturingCallPhase,
  opts?: { t0Channel?: T0MessageChannel },
): NoContactFollowupPlan {
  const t0 = opts?.t0Channel ?? 'whatsapp';

  switch (phase) {
    case 't0':
      return {
        sendWhatsApp: t0 === 'whatsapp' || t0 === 'both',
        sendSms: t0 === 'sms' || t0 === 'both',
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
