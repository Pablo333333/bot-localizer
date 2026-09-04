import { Injectable, Logger } from '@nestjs/common';
import { CallOutcome } from '../enums';

/**
 * Clasifica el resultado de una llamada Retell.
 * Importante Toni: "no contesta" / colgado / busy / declined ≠ cerrado.
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

    this.logger.log(
      `Clasificando call=${callData.call_id || '?'} reason="${reason}" status="${callStatus}" successful=${callData.call_analysis?.call_successful}`,
    );

    // Rechazo explícito en conversación (sí → cerrado). No confundir con user_declined (rechazó la llamada).
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

    // --- No conectó / no contactó (siempre nurturing) ---
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
    if (this.isNoAnswerReason(reason)) {
      return CallOutcome.NO_ANSWER;
    }

    // user_hangup / agent_hangup / canceled: sin éxito de análisis → seguimiento
    if (this.isHangupReason(reason) || this.isCanceledReason(reason)) {
      if (callData.call_analysis?.call_successful === true) {
        // Colgó tras conversación útil
        return CallOutcome.ANSWERED_SUCCESS;
      }
      const duration = this.resolveDurationMs(callData);
      // Duración 0 / corta / sin éxito → tratar como no-contacto (WA + enroll)
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration < 15_000 ||
        callData.call_analysis?.call_successful === false ||
        callData.call_analysis?.call_successful == null
      ) {
        return CallOutcome.HANGUP;
      }
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

    // call_status ended sin success ni reason claro → no forzar WA
    return CallOutcome.UNKNOWN;
  }

  /** Outcomes que disparan WhatsApp T+0 + enroll T+7/T+10 */
  shouldSendBookingWhatsApp(outcome: CallOutcome): boolean {
    return (
      outcome === CallOutcome.NO_ANSWER ||
      outcome === CallOutcome.HANGUP ||
      outcome === CallOutcome.VOICEMAIL ||
      outcome === CallOutcome.BUSY
    );
  }

  /** Solo rechazo explícito en conversación → cerrado. Nunca no-contesta/busy/hangup. */
  shouldMarkClosed(outcome: CallOutcome): boolean {
    return outcome === CallOutcome.EXPLICIT_REJECTION;
  }

  /**
   * En call_ended (antes del análisis): solo nurturing si está claro que no hubo
   * conversación. Evita WA prematuro en user_hangup de llamadas exitosas.
   */
  isClearNoContactBeforeAnalysis(callData: Record<string, any>): boolean {
    const reason = this.resolveDisconnectionReason(callData);
    const callStatus = this.resolveCallStatus(callData);
    if (callStatus === 'not_connected') return true;
    if (this.isBusyReason(reason)) return true;
    if (this.isVoicemailReason(reason)) return true;
    if (this.isNoAnswerReason(reason)) return true;
    return false;
  }

  private resolveDisconnectionReason(callData: Record<string, any>): string {
    return String(
      callData.disconnection_reason ||
        callData.disconnect_reason ||
        callData.call?.disconnection_reason ||
        '',
    )
      .toLowerCase()
      .trim();
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

  private isHangupReason(reason: string): boolean {
    return (
      reason.includes('user_hangup') ||
      reason.includes('user_hung_up') ||
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
