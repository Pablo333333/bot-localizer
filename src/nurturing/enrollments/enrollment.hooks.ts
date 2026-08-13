/**
 * Puntos de enganche desde Inbound / Sheets / Outbound.
 * Se cablearán en la siguiente iteración.
 */
export const ENROLLMENT_HOOK_SOURCES = {
  WHATSAPP_INBOUND: 'whatsapp_inbound',
  OUTBOUND: 'outbound',
  SHEETS_SYNC: 'sheets_sync',
  MANUAL: 'manual',
} as const;

export type EnrollmentHookSource =
  (typeof ENROLLMENT_HOOK_SOURCES)[keyof typeof ENROLLMENT_HOOK_SOURCES];
