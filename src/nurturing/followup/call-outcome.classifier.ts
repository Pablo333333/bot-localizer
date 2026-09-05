import { Injectable, Logger } from '@nestjs/common';
import { CallOutcome } from '../enums';

/**
 * Clasifica el resultado de una llamada Retell.
 *
 * - NO_ANSWER / BUSY / VOICEMAIL / POSTPONE → mensaje T+0 + enroll T+7/T+10 + PENDIENTE
 * - HANGUP (cuelgue a mitad) u otras casuísticas → PENDIENTE, sin cola T+7/T+10
 * - EXPLICIT_REJECTION → cerrado
 *
 * @see https://docs.retellai.com/reliability/debug-call-disconnect
 */
@Injectable()
export class CallOutcomeClassifier {
  private readonly logger = new Logger(CallOutcomeClassifier.name);

  classify(callData: Record<string, any>): CallOutcome {
    const reason = this.resolveDisconnectionReason(callData);
    const callStatus = this.resolveCallStatus(callData);
    const summary = String(
      callData.call_analysis?.call_summary || '',
    ).toLowerCase();
    const cad = callData.call_analysis?.custom_analysis_data || {};
    const estado = String(cad.estado || cad.resultado || '').toLowerCase();
    const duration = this.resolveDurationMs(callData);

    this.logger.log(
      `Clasificando call=${callData.call_id || '?'} reason="${reason}" status="${callStatus}" successful=${callData.call_analysis?.call_successful} duration_ms=${duration}`,
    );

    // Rechazo explícito en conversación (sí → cerrado). No confundir con user_declined.
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

    // Posponer / callback → enroll T+7/T+10 (antes que hangup genérico)
    if (this.isPostponeSignal(summary, estado, cad)) {
      this.logger.log(
        `postpone detectado → POSTPONE (enroll T+7/T+10). call=${callData.call_id}`,
      );
      return CallOutcome.POSTPONE;
    }

    // user_hangup → PENDIENTE sin enroll (cuelgue a mitad / corta conversación)
    if (this.isUserHangupReason(reason)) {
      this.logger.log(
        `user_hangup → HANGUP (PENDIENTE, sin enroll T+7/T+10). call_successful=${callData.call_analysis?.call_successful}`,
      );
      return CallOutcome.HANGUP;
    }

    // --- No conectó / no contactó → NO_ANSWER (+ busy/voicemail) ---
    if (this.isNoAnswerReason(reason) || callStatus === 'not_connected') {
      if (this.isBusyReason(reason)) return CallOutcome.BUSY;
      if (this.isVoicemailReason(reason)) return CallOutcome.VOICEMAIL;
      if (this.isHangupReason(reason)) return CallOutcome.HANGUP;
      return CallOutcome.NO_ANSWER;
    }

    if (this.isBusyReason(reason)) {
      return CallOutcome.BUSY;
    }
    if (this.isVoicemailReason(reason)) {
      return CallOutcome.VOICEMAIL;
    }
    if (this.isNoAnswerReason(reason) || this.isCanceledReason(reason)) {
      return CallOutcome.NO_ANSWER;
    }

    // agent_hangup / manual_stopped: sin éxito de negocio → HANGUP; con éxito → OK
    if (this.isHangupReason(reason)) {
      if (
        callData.call_analysis?.call_successful === true &&
        duration >= 15_000
      ) {
        return CallOutcome.ANSWERED_SUCCESS;
      }
      return CallOutcome.HANGUP;
    }

    if (callData.call_analysis?.call_successful === true) {
      return CallOutcome.ANSWERED_SUCCESS;
    }

    if (callData.call_analysis?.call_successful === false) {
      this.logger.log(
        `call_successful=false sin rechazo explícito → NO_ANSWER (call=${callData.call_id})`,
      );
      return CallOutcome.NO_ANSWER;
    }

    return CallOutcome.UNKNOWN;
  }

  /**
   * Enroll cola T+7/T+10: solo no_answer (y equivalentes sin conexión) o posponer.
   * Hangup a mitad NO enrolla.
   */
  shouldEnrollRetrySequence(outcome: CallOutcome): boolean {
    return (
      outcome === CallOutcome.NO_ANSWER ||
      outcome === CallOutcome.POSTPONE ||
      outcome === CallOutcome.BUSY ||
      outcome === CallOutcome.VOICEMAIL
    );
  }

  /** WhatsApp/SMS booking T+0: misma regla que enroll (no hangup). */
  shouldSendBookingWhatsApp(outcome: CallOutcome): boolean {
    return this.shouldEnrollRetrySequence(outcome);
  }

  /**
   * PENDIENTE: no_answer/postpone (con enroll) y hangup / otras casuísticas
   * sin éxito ni cierre.
   */
  shouldMarkPendiente(outcome: CallOutcome): boolean {
    return (
      this.shouldEnrollRetrySequence(outcome) ||
      outcome === CallOutcome.HANGUP ||
      outcome === CallOutcome.UNKNOWN
    );
  }

  /** Solo rechazo explícito en conversación → cerrado. */
  shouldMarkClosed(outcome: CallOutcome): boolean {
    return outcome === CallOutcome.EXPLICIT_REJECTION;
  }

  /**
   * En call_ended: nurturing temprano si no-conexión, postpone o hangup
   * (hangup solo para marcar PENDIENTE; enroll espera no_answer).
   */
  isClearNoContactBeforeAnalysis(callData: Record<string, any>): boolean {
    const reason = this.resolveDisconnectionReason(callData);
    const callStatus = this.resolveCallStatus(callData);
    const summary = String(
      callData.call_analysis?.call_summary || '',
    ).toLowerCase();
    const cad = callData.call_analysis?.custom_analysis_data || {};
    const estado = String(cad.estado || cad.resultado || '').toLowerCase();

    if (this.isPostponeSignal(summary, estado, cad)) return true;
    if (callStatus === 'not_connected') return true;
    if (this.isBusyReason(reason)) return true;
    if (this.isVoicemailReason(reason)) return true;
    if (this.isNoAnswerReason(reason)) return true;
    if (this.isCanceledReason(reason)) return true;
    if (this.isUserHangupReason(reason)) return true;
    return false;
  }

  private isPostponeSignal(
    summary: string,
    estado: string,
    cad: Record<string, unknown>,
  ): boolean {
    const hints = [
      'posponer',
      'pospuesto',
      'más tarde',
      'mas tarde',
      'otro día',
      'otro dia',
      'llamar después',
      'llamar despues',
      'callback',
      'call back',
      'reagendar',
      're-agendar',
      'no ahora',
      'más adelante',
      'mas adelante',
    ];
    if (estado === 'posponer' || estado === 'postpone' || estado === 'pendiente') {
      return true;
    }
    const intent = String(
      cad.intencion || cad.intention || cad.next_action || '',
    ).toLowerCase();
    if (
      intent.includes('pospon') ||
      intent.includes('callback') ||
      intent.includes('reagend')
    ) {
      return true;
    }
    return hints.some((h) => summary.includes(h) || estado.includes(h));
  }

  private resolveDisconnectionReason(callData: Record<string, any>): string {
    return String(
      callData.disconnection_reason ||
        callData.disconnect_reason ||
        callData.call?.disconnection_reason ||
        '',
    )
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');
  }

  private resolveCallStatus(callData: Record<string, any>): string {
    return String(
      callData.call_status || callData.status || callData.call?.call_status || '',
    )
      .toLowerCase()
      .trim();
  }

  private resolveDurationMs(callData: Record<string, any>): number {
    const raw =
      callData.duration_ms ??
      callData.call?.duration_ms ??
      callData.duration ??
      0;
    return Number(raw);
  }

  private isNoAnswerReason(reason: string): boolean {
    if (!reason) return false;
    return (
      reason.includes('dial_no_answer') ||
      reason.includes('no_answer') ||
      reason.includes('not_answered') ||
      reason.includes('user_declined') ||
      reason.includes('dial_failed') ||
      reason.includes('registered_call_timeout') ||
      reason.includes('error_user_not_joined') ||
      reason.includes('invalid_destination') ||
      reason === 'canceled' ||
      reason === 'cancelled' ||
      reason.includes('dial_cancel')
    );
  }

  private isBusyReason(reason: string): boolean {
    return reason.includes('busy') || reason.includes('dial_busy');
  }

  private isVoicemailReason(reason: string): boolean {
    return reason.includes('voicemail');
  }

  /** Solo colgado por el usuario (no agent_hangup). */
  private isUserHangupReason(reason: string): boolean {
    return (
      reason.includes('user_hangup') ||
      reason.includes('user_hung_up') ||
      reason === 'user hangup' ||
      reason.replace(/_/g, ' ').includes('user hangup')
    );
  }

  private isHangupReason(reason: string): boolean {
    return (
      this.isUserHangupReason(reason) ||
      reason.includes('agent_hangup') ||
      reason === 'hangup' ||
      reason.includes('manual_stopped')
    );
  }

  private isCanceledReason(reason: string): boolean {
    return (
      reason === 'canceled' ||
      reason === 'cancelled' ||
      reason.includes('dial_cancel') ||
      reason.includes('transfer_cancelled')
    );
  }
}
