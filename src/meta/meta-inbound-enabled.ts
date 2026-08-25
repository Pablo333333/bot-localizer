/**
 * Auto-reply Messenger/Instagram desactivado por defecto para no colisionar con GHL.
 * Solo true / 'true' / '1' / 'yes' / 'si' lo activan.
 */
export const META_INBOUND_DISABLED_LOG =
  'Meta inbound auto-reply disabled (GoHighLevel owns Messenger/Instagram DM)';

export function isMetaInboundAutoReplyEnabled(
  raw?: string | boolean | null,
): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}
