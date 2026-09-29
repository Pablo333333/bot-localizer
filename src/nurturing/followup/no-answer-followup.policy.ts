import { CallOutcome } from '../enums';
import type { NurturingCallPhase } from '../toni-fase3.constants';

export interface NoContactFollowupPlan {
  sendWhatsApp: boolean;
  sendSms: boolean;
  enroll: boolean;
  /** Tras la llamada 2: encolar la llamada 3 si aún no está en BullMQ. */
  scheduleNextCall: boolean;
  markIlocalizable: boolean;
  /** Cierra enrollments activos al marcar ILOCALIZABLE. */
  endSequence: boolean;
}

/**
 * Canal T+0:
 * - sms (default): Content Template aprobado para SMS; WA business aún no.
 * - whatsapp: solo si NURTURING_WHATSAPP_ENABLED=true y plantilla WA aprobada.
 * - both: intenta WA y SMS (WA se salta si el gate está off).
 */
export type T0MessageChannel = 'whatsapp' | 'sms' | 'both';

export function resolveT0MessageChannel(
  raw?: string | null,
): T0MessageChannel {
  const v = String(raw ?? 'sms')
    .trim()
    .toLowerCase();
  if (v === 'whatsapp' || v === 'wa') return 'whatsapp';
  if (v === 'both' || v === 'whatsapp+sms' || v === 'wa+sms') return 'both';
  return 'sms';
}

/**
 * Acciones de seguimiento por fase.
 * `enroll` en T+0: no-contacto, o cuelgue (`bookingFallback`) — ambos programan la llamada 2.
 * `bookingFallback`: SMS/WA con link de cita tras hangup en la llamada 1.
 */
export function planNoContactFollowup(
  phase: NurturingCallPhase,
  opts?: {
    t0Channel?: T0MessageChannel;
    enroll?: boolean;
    /** Hangup / interacción: enviar mensaje de cita sin enrollar. */
    bookingFallback?: boolean;
  },
): NoContactFollowupPlan {
  const t0 = opts?.t0Channel ?? 'sms';
  const enroll = opts?.enroll === true;
  const bookingFallback = opts?.bookingFallback === true;

  switch (phase) {
    case 't0': {
      const sendMessage = enroll || bookingFallback;
      return {
        sendWhatsApp: sendMessage && (t0 === 'whatsapp' || t0 === 'both'),
        sendSms: sendMessage && (t0 === 'sms' || t0 === 'both'),
        enroll: enroll || bookingFallback,
        scheduleNextCall: false,
        markIlocalizable: false,
        endSequence: false,
      };
    }
    case 't7':
      return {
        sendWhatsApp: false,
        sendSms: true,
        enroll: false,
        scheduleNextCall: true,
        markIlocalizable: false,
        endSequence: false,
      };
    case 't10':
      return {
        sendWhatsApp: false,
        sendSms: false,
        enroll: false,
        scheduleNextCall: false,
        markIlocalizable: true,
        endSequence: true,
      };
    default:
      return {
        sendWhatsApp: false,
        sendSms: false,
        enroll: false,
        scheduleNextCall: false,
        markIlocalizable: false,
        endSequence: false,
      };
  }
}

function isNoContactOutcome(outcome: CallOutcome): boolean {
  return (
    outcome === CallOutcome.NO_ANSWER ||
    outcome === CallOutcome.POSTPONE ||
    outcome === CallOutcome.BUSY ||
    outcome === CallOutcome.VOICEMAIL
  );
}

/**
 * Llamada 2 (T+7): SMS de respaldo + encolar llamada 3 si no contestó o contestó y colgó.
 * Llamada 3 (T+10): ILOCALIZABLE solo si no hubo contacto.
 */
export function adjustPlanForCallOutcome(
  plan: NoContactFollowupPlan,
  phase: NurturingCallPhase,
  outcome: CallOutcome,
): NoContactFollowupPlan {
  if (phase === 't7') {
    const continueFlow = isNoContactOutcome(outcome) || outcome === CallOutcome.HANGUP;
    return {
      ...plan,
      sendWhatsApp: false,
      sendSms: continueFlow,
      enroll: false,
      scheduleNextCall: continueFlow,
      markIlocalizable: false,
      endSequence: false,
    };
  }
  if (phase === 't10') {
    const unreachable = isNoContactOutcome(outcome);
    return {
      ...plan,
      sendWhatsApp: false,
      sendSms: false,
      enroll: false,
      scheduleNextCall: false,
      markIlocalizable: unreachable,
      endSequence: unreachable,
    };
  }
  return plan;
}
