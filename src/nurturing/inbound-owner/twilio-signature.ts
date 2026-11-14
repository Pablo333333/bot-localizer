import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validación X-Twilio-Signature.
 * TWILIO_VALIDATE_SIGNATURE=true|1|yes → obligatorio.
 * false/vacío → se omite (pruebas locales).
 */
export function isTwilioSignatureValidationEnabled(
  raw?: string | boolean | null,
): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'si' || v === 'sí';
}

/**
 * Construye la URL pública que Twilio firmó (https + host + path + query).
 */
export function buildTwilioSignedUrl(params: {
  protocol?: string;
  host?: string;
  originalUrl?: string;
  /** Override completo (p.ej. PUBLIC_BASE_URL + path) */
  webhookUrl?: string;
}): string {
  if (params.webhookUrl?.trim()) {
    return params.webhookUrl.trim();
  }
  const proto = (params.protocol || 'https').replace(/:$/, '');
  const host = params.host || 'localhost';
  const path = params.originalUrl || '/v2/whatsapp';
  return `${proto}://${host}${path}`;
}

/**
 * Firma Twilio: HMAC-SHA1(authToken, url + sorted POST body as key+value concat).
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  body: Record<string, unknown>,
): string {
  const keys = Object.keys(body).sort();
  let data = url;
  for (const key of keys) {
    const value = body[key];
    data += key + String(value ?? '');
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function verifyTwilioSignature(params: {
  authToken: string;
  signatureHeader?: string | string[] | null;
  url: string;
  body: Record<string, unknown>;
}): boolean {
  const expected = computeTwilioSignature(
    params.authToken,
    params.url,
    params.body,
  );
  const provided = Array.isArray(params.signatureHeader)
    ? params.signatureHeader[0]
    : params.signatureHeader;
  if (!provided || typeof provided !== 'string') return false;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
