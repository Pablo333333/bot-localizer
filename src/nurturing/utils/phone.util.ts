/**
 * Normaliza teléfonos para dedupe (WhatsApp prefix, espacios, guiones).
 * Conserva el `+` inicial si venía en el input.
 */
export function normalizePhone(raw: string): string {
  let value = raw.trim();
  if (value.toLowerCase().startsWith('whatsapp:')) {
    value = value.slice('whatsapp:'.length).trim();
  }
  const hasPlus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Phone number is empty after normalization');
  }
  return hasPlus ? `+${digits}` : digits;
}

/** Clave de dedupe solo dígitos */
export function phoneDedupeKey(raw: string): string {
  return normalizePhone(raw).replace(/\D/g, '');
}

/** Formato E.164 España (+34…) usado por Retell / Twilio */
export function formatE164Spain(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  if (normalized.startsWith('+')) return normalized;
  if (normalized.startsWith('34')) return `+${normalized}`;
  return `+34${normalized}`;
}

export function toWhatsAppAddress(rawPhone: string): string {
  const e164 = formatE164Spain(rawPhone);
  return e164.toLowerCase().startsWith('whatsapp:')
    ? e164
    : `whatsapp:${e164}`;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
