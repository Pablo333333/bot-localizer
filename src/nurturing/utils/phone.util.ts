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

/** Prefijos internacionales frecuentes en celdas mal pegadas del Sheet. */
const KNOWN_COUNTRY_CODES = [
  '351',
  '34',
  '31',
  '33',
  '39',
  '49',
  '44',
  '1',
] as const;

/**
 * Colapsa prefijos duplicados o encadenados (+34+34…, +34+31…).
 * Prefiere quedarse con el tramo que contiene un móvil ES (6/7 + 8 dígitos).
 */
export function collapseDuplicateCountryPrefixes(digitsRaw: string): string {
  let digits = String(digitsRaw || '').replace(/\D/g, '');
  if (!digits) return digits;

  let guard = 0;
  while (guard++ < 8) {
    let changed = false;
    for (const cc of KNOWN_COUNTRY_CODES) {
      if (digits.startsWith(cc + cc)) {
        digits = digits.slice(cc.length);
        changed = true;
        break;
      }
      for (const cc2 of KNOWN_COUNTRY_CODES) {
        if (cc === cc2) continue;
        if (!digits.startsWith(cc + cc2)) continue;
        // +34+31… → conservar desde el segundo prefijo; el extractor ES
        // recuperará el móvil si aparece más adelante.
        digits = digits.slice(cc.length);
        changed = true;
        break;
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return digits;
}

/** Móvil español 9 dígitos (6/7…). */
export function extractSpanishMobileDigits(digitsRaw: string): string | null {
  const digits = String(digitsRaw || '').replace(/\D/g, '');
  if (!digits) return null;

  const withCc = digits.match(/34([67]\d{8})/);
  if (withCc) return withCc[1];

  if (/^[67]\d{8}$/.test(digits)) return digits;

  if (digits.length > 9) {
    const last9 = digits.slice(-9);
    if (/^[67]\d{8}$/.test(last9)) return last9;
  }
  return null;
}

/** Formato E.164 España (+34…) usado por Retell / Twilio */
export function formatE164Spain(rawPhone: string): string {
  const normalized = normalizePhone(rawPhone);
  const collapsed = collapseDuplicateCountryPrefixes(
    normalized.replace(/\D/g, ''),
  );
  const mobile = extractSpanishMobileDigits(collapsed);
  if (mobile) return `+34${mobile}`;

  if (collapsed.startsWith('34') && collapsed.length >= 11) {
    return `+${collapsed}`;
  }
  if (collapsed.length === 9) return `+34${collapsed}`;
  if (collapsed.startsWith('34')) return `+${collapsed}`;
  return `+34${collapsed}`;
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
