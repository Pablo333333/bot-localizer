/**
 * Auto-reply Localisto en DMs de X.
 * true / 'true' / '1' / 'yes' / 'si' → activo.
 * Ausente → true si hay X_AGENT_ID (modo chat dedicado); si no, false.
 */
export const X_INBOUND_DISABLED_LOG =
  'X inbound auto-reply disabled via environment variable';

export function isXInboundAutoReplyEnabled(
  raw?: string | boolean | null,
  hasAgentId?: boolean,
): boolean {
  if (raw === true) return true;
  if (raw === false) return false;
  if (raw == null || String(raw).trim() === '') {
    return Boolean(hasAgentId);
  }
  const v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si';
}

/** Lee credenciales con alias legacy (.env.example antiguo). */
export function resolveXCredentials(get: (key: string) => string | undefined): {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessSecret?: string;
} {
  return {
    apiKey: get('X_API_KEY') || get('X_CONSUMER_KEY'),
    apiSecret: get('X_API_SECRET') || get('X_CONSUMER_SECRET'),
    accessToken: get('X_ACCESS_TOKEN'),
    accessSecret: get('X_ACCESS_SECRET') || get('X_ACCESS_TOKEN_SECRET'),
  };
}
