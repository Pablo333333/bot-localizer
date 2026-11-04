/**
 * Errores de Twilio/WhatsApp que no merecen reintento BullMQ
 * (canal/plantilla inexistente, cuenta inactiva, número inválido, etc.).
 */

const PERMANENT_TWILIO_CODES = new Set([
  20003, // Authentication Error
  20404, // Not Found
  21211, // Invalid 'To' Phone Number
  21408, // Permission to send to this region
  21608, // Unsubscribed recipient
  21610, // Attempt to send to unsubscribed
  21614, // 'To' number is not a valid mobile
  63007, // Twilio could not find a Channel with the From address
  63016, // Failed to send freeform message (outside session)
  63032, // Channel not found / not configured
]);

const PERMANENT_PATTERN =
  /channel not found|could not find a channel|template.*(not found|invalid)|account.*(inactive|disabled|not active|suspended)|from address|63007|63016|63032|unsubscribed|invalid.*(to|phone|number)/i;

export function isPermanentMessagingError(
  message?: string | null,
  code?: number | string | null,
): boolean {
  if (code != null && String(code).trim() !== '') {
    const n = Number(code);
    if (Number.isFinite(n) && PERMANENT_TWILIO_CODES.has(n)) return true;
  }
  const text = `${code ?? ''} ${message ?? ''}`.trim();
  if (!text) return false;
  return PERMANENT_PATTERN.test(text);
}
