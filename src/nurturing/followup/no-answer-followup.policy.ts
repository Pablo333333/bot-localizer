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
 * Acciones de seguimiento por fase.
 * `enroll` en T+0 solo si el caller pasa enroll=true (no_answer / postpone).
 * Hangup: el servicio marca PENDIENTE sin enroll.
 */
export function planNoContactFollowup(
  phase: NurturingCallPhase,
  opts?: { t0Channel?: T0MessageChannel; enroll?: boolean },
): NoContactFollowupPlan {
  const t0 = opts?.t0Channel ?? 'whatsapp';
  const enroll = opts?.enroll === true;

  switch (phase) {
    case 't0':
      return {
        sendWhatsApp: enroll && (t0 === 'whatsapp' || t0 === 'both'),
        sendSms: enroll && (t0 === 'sms' || t0 === 'both'),
        enroll,
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
