export enum LeadStatus {
  NUEVO = 'nuevo',
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
  HANGUP = 'hangup',
  VOICEMAIL = 'voicemail',
  BUSY = 'busy',
  EXPLICIT_REJECTION = 'explicit_rejection',
  UNKNOWN = 'unknown',
}
