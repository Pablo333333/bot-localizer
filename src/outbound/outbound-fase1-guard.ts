/**
 * Blindaje Fase 1: no depender solo de Llamado vacío.
 * Reutiliza helpers de conversión / disponibilidad de Fase 3.
 */
import { EnrollmentStatus, LeadStatus } from '@prisma/client';
import { sheetRowHasSuccessfulConversion } from '../nurturing/sync/backfill-unreached';
import { sheetRowSaysPropertyUnavailable } from '../nurturing/followup/property-unavailable';

export const FASE1_MARKED_LLAMADO = new Set([
  'SI',
  'SÍ',
  'INTENTADO',
  'YES',
  'TRUE',
]);

type SheetRowLike = { get: (header: string) => unknown };

export type Fase1LeadGuardInput = {
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  /** true si hay SequenceEnrollment active o completed */
  hasActiveOrCompletedEnrollment?: boolean;
};

/** Llamado vacío o no marcado → candidato a recuperación controlada. */
export function isLlamadoClearedForRetry(llamadoRaw: string): boolean {
  const llamado = String(llamadoRaw || '')
    .trim()
    .toUpperCase();
  if (!llamado) return true;
  return !FASE1_MARKED_LLAMADO.has(llamado);
}

/**
 * Call ID solo bloquea si Llamado sigue marcado.
 * Si Toni vació Llamado pero dejó Call ID, se permite reintento
 * (siempre que pasen conversión / disponibilidad / BD).
 */
export function shouldBlockOnExistingCallId(params: {
  llamadoRaw: string;
  callId: string;
}): boolean {
  const callId = String(params.callId || '').trim();
  if (!callId) return false;
  return !isLlamadoClearedForRetry(params.llamadoRaw);
}

export function isLeadDoNotContact(
  meta: Record<string, unknown> | null | undefined,
): boolean {
  if (!meta) return false;
  const v = meta.doNotContact ?? meta.do_not_contact ?? meta.opt_out;
  if (v === true || v === 1) return true;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'si' || s === 'sí';
}

export function isLeadCommercialRejection(
  lead: Fase1LeadGuardInput,
): boolean {
  const meta = lead.metadata || {};
  if (meta.commercial_rejection === true) return true;
  if (meta.no_interesado === true) return true;
  const reason = String(
    meta.commercial_rejection_reason ??
      meta.nurturing_suppressed ??
      meta.cancelReason ??
      '',
  )
    .toLowerCase()
    .trim();
  if (
    reason.includes('no_interesado') ||
    reason.includes('no-interesado') ||
    reason.includes('not_interested') ||
    reason.includes('rechazo_comercial')
  ) {
    return true;
  }
  if (lead.status === LeadStatus.cerrado && reason) {
    return (
      reason.includes('interes') ||
      reason.includes('rechaz') ||
      reason.includes('reject')
    );
  }
  return false;
}

export function fase1SheetHardBlockReason(
  row: SheetRowLike,
  headerValues?: string[],
): string | null {
  if (sheetRowHasSuccessfulConversion(row, headerValues)) {
    return 'Conversión ya registrada (Propietario contactado? / Publicación Autorizada? / WP Post ID)';
  }
  if (sheetRowSaysPropertyUnavailable(row, headerValues)) {
    return 'Disponibilidad = NO';
  }
  return null;
}

export function fase1LeadHardBlockReason(
  lead: Fase1LeadGuardInput | null | undefined,
): string | null {
  if (!lead) return null;
  if (isLeadDoNotContact(lead.metadata)) {
    return 'Lead con doNotContact / opt-out';
  }
  if (isLeadCommercialRejection(lead)) {
    return 'Lead marcado como NO INTERESADO / rechazo comercial';
  }
  if (lead.hasActiveOrCompletedEnrollment) {
    return 'Lead con enrollment Fase 3 activo o finalizado';
  }
  return null;
}

export const FASE1_ENROLLMENT_BLOCK_STATUSES: EnrollmentStatus[] = [
  EnrollmentStatus.active,
  EnrollmentStatus.completed,
];
