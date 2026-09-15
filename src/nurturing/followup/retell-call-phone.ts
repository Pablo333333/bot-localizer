/**
 * Extrae el teléfono del destinatario (lead) desde payloads Retell variables.
 * Outbound: to_number = callee. Inbound: from_number = caller.
 */
export function resolveRetellLeadPhone(
  callData: Record<string, any>,
  body?: Record<string, any>,
): string {
  const direction = String(
    callData.direction ||
      callData.call_type ||
      body?.call?.direction ||
      '',
  )
    .toLowerCase()
    .trim();

  const to =
    callData.to_number ||
    callData.toNumber ||
    callData.telephony_identifier ||
    body?.call?.to_number ||
    body?.to_number ||
    '';
  const from =
    callData.from_number ||
    callData.fromNumber ||
    body?.call?.from_number ||
    body?.from_number ||
    '';

  // Inbound: el lead es quien llama
  if (direction.includes('inbound')) {
    return String(from || to || '').trim();
  }

  // Outbound / default: el lead es el destino
  return String(to || from || '').trim();
}
