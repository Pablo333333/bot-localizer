export enum LeadStatus {
  NUEVO = 'nuevo',
  /** Hangup / no_answer / postpone: seguimiento. Enroll T+7/T+10 solo no_answer|postpone. */
  PENDIENTE = 'pendiente',
  INTERESADO = 'interesado',
  /** Estado Toni: cita agendada — detiene secuencias activas */
  CITA_PROGRAMADA = 'cita_programada',
  /** Rechazo explícito / cerrado — detiene secuencias. NO usar para "no contesta". */
  CERRADO = 'cerrado',
  /** Tras T+10 sin contacto. Detiene secuencias. */
  ILOCALIZABLE = 'ilocalizable',
}

/**
 * Solo estos estados cancelan jobs BullMQ.
 * "no contesta" / colgado NO deben mapearse a cerrado ni a cita_programada.
 */
export const TERMINAL_LEAD_STATUSES: ReadonlySet<LeadStatus> = new Set([
  LeadStatus.CITA_PROGRAMADA,
  LeadStatus.CERRADO,
  LeadStatus.ILOCALIZABLE,
]);

/** Outcomes de llamada Retell que NO deben cerrar el lead ni auto-stop */
export enum CallOutcome {
  ANSWERED_SUCCESS = 'answered_success',
  NO_ANSWER = 'no_answer',
  /** Cliente pidió llamar más tarde / posponer — enroll T+7/T+10 */
  POSTPONE = 'postpone',
  HANGUP = 'hangup',
  VOICEMAIL = 'voicemail',
  BUSY = 'busy',
  EXPLICIT_REJECTION = 'explicit_rejection',
  UNKNOWN = 'unknown',
}
