/**
 * Filtro de prueba Outbound: si OUTBOUND_TEST_PHONE_ONLY está definido,
 * solo se llama a ese número (comparación por dígitos, sin +/espacios).
 */

export function resolveOutboundTestPhoneOnly(
  raw?: string | null,
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed;
}

/** Solo dígitos, para comparar +34644408099 vs 644408099 vs 34644408099. */
export function phoneDigitsKey(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * true si el teléfono del lead coincide con el filtro de prueba.
 * Acepta match exacto de dígitos o sufijo (644408099 ⊆ 34644408099).
 */
export function matchesOutboundTestPhone(
  candidatePhone: string,
  testPhone: string,
): boolean {
  const a = phoneDigitsKey(candidatePhone);
  const b = phoneDigitsKey(testPhone);
  if (!a || !b) return false;
  if (a === b) return true;
  // 644408099 vs 34644408099 (E.164 España)
  return a.endsWith(b) || b.endsWith(a);
}
