import { LeadStatus, TERMINAL_LEAD_STATUSES } from '../enums';

/** True si el cambio de estado debe cancelar secuencias activas */
export function shouldStopSequences(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.has(status);
}
