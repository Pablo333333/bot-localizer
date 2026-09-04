import { createHmac, randomBytes } from 'crypto';

export interface XOAuthCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/**
 * Cabecera Authorization OAuth 1.0a (User Context) para X API.
 * Necesaria para DMs (no vale Bearer app-only).
 */
export function buildOAuth1Header(
  method: string,
  url: string,
  credentials: XOAuthCredentials,
  extraParams: Record<string, string> = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  const allParams: Record<string, string> = { ...extraParams, ...oauth };
  const paramString = Object.keys(allParams)
    .sort()
    .map(
      (k) =>
        `${percentEncode(k)}=${percentEncode(allParams[k])}`,
    )
    .join('&');

  const baseUrl = url.split('?')[0];
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join('&');

  const signingKey = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  const header =
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(', ');

  return header;
}

export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*()']/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** CRC challenge Account Activity API: response_token = sha256=<hmac_base64> */
export function buildCrcResponseToken(
  crcToken: string,
  consumerSecret: string,
): string {
  const hash = createHmac('sha256', consumerSecret)
    .update(crcToken)
    .digest('base64');
  return `sha256=${hash}`;
}
