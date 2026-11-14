import {
  computeTwilioSignature,
  isTwilioSignatureValidationEnabled,
  verifyTwilioSignature,
} from './twilio-signature';

describe('twilio-signature', () => {
  it('flag de validación', () => {
    expect(isTwilioSignatureValidationEnabled('true')).toBe(true);
    expect(isTwilioSignatureValidationEnabled('false')).toBe(false);
    expect(isTwilioSignatureValidationEnabled('')).toBe(false);
  });

  it('verifica HMAC', () => {
    const authToken = 'test_token';
    const url = 'https://example.com/v2/whatsapp';
    const body = { From: 'whatsapp:+34600000000', Body: 'hola' };
    const signature = computeTwilioSignature(authToken, url, body);
    expect(
      verifyTwilioSignature({
        authToken,
        signatureHeader: signature,
        url,
        body,
      }),
    ).toBe(true);
    expect(
      verifyTwilioSignature({
        authToken,
        signatureHeader: 'invalid',
        url,
        body,
      }),
    ).toBe(false);
  });
});
