import { Injectable, Logger } from '@nestjs/common';
import { CallOutcome } from '../enums';

/**
 * Clasifica el resultado de una llamada Retell.
 * Importante Toni: "no contesta" / colgado ≠ cerrado / rechazo.
 */
@Injectable()
export class CallOutcomeClassifier {
  private readonly logger = new Logger(CallOutcomeClassifier.name);

  classify(callData: Record<string, any>): CallOutcome {
    const reason = String(callData.disconnection_reason || '').toLowerCase();
    const summary = String(
      callData.call_analysis?.call_summary || '',
    ).toLowerCase();
    const cad = callData.call_analysis?.custom_analysis_data || {};
    const estado = String(cad.estado || cad.resultado || '').toLowerCase();

    // Rechazo explícito (sí debe poder mapear a cerrado)
    const rejectionHints = [
      'no le interesa',
      'no interesa',
      'no quiere',
      'rechaz',
      'no molestar',
      'sacar de la lista',
    ];
    if (
      rejectionHints.some((h) => summary.includes(h) || estado.includes(h)) ||
      estado === 'cerrado' ||
      estado === 'rechazado'
    ) {
      return CallOutcome.EXPLICIT_REJECTION;
    }

    if (
      reason.includes('dial_no_answer') ||
      reason.includes('no_answer') ||
      reason.includes('not_answered')
    ) {
      return CallOutcome.NO_ANSWER;
    }
    if (reason.includes('voicemail')) {
      return CallOutcome.VOICEMAIL;
    }
    if (reason.includes('busy') || reason.includes('dial_busy')) {
      return CallOutcome.BUSY;
    }
    if (
      reason.includes('user_hangup') ||
      reason.includes('agent_hangup') ||
      reason.includes('hangup')
    ) {
      // Colgado temprano sin conversación útil → tratar como hangup, NO cerrado
      const duration = Number(callData.duration_ms || callData.duration || 0);
      if (duration > 0 && duration < 15_000) {
        return CallOutcome.HANGUP;
      }
    }

    if (callData.call_analysis?.call_successful === true) {
      return CallOutcome.ANSWERED_SUCCESS;
    }

    if (callData.call_analysis?.call_successful === false) {
      // Fallo genérico sin rechazo explícito → no_answer-like (seguir nurturing)
      this.logger.log(
        `call_successful=false sin rechazo explícito → NO_ANSWER (call=${callData.call_id})`,
      );
      return CallOutcome.NO_ANSWER;
    }

    return CallOutcome.UNKNOWN;
  }

  /** Outcomes que disparan WhatsApp con link de agendamiento */
  shouldSendBookingWhatsApp(outcome: CallOutcome): boolean {
    return (
      outcome === CallOutcome.NO_ANSWER ||
      outcome === CallOutcome.HANGUP ||
      outcome === CallOutcome.VOICEMAIL ||
      outcome === CallOutcome.BUSY
    );
  }

  /** Solo rechazo explícito → cerrado. Nunca no-contesta. */
  shouldMarkClosed(outcome: CallOutcome): boolean {
    return outcome === CallOutcome.EXPLICIT_REJECTION;
  }
}
