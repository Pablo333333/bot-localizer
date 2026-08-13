import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PropertyPublishedEmailInput {
  to: string;
  propertyTitle: string;
  propertyUrl: string;
  callId?: string;
}

/**
 * Email post-creación de anuncio vía Resend (Toni).
 * From: somos@localicer.com — API key en RESEND_API_KEY (nunca hardcodeada).
 */
@Injectable()
export class PropertyPublishEmailService {
  private readonly logger = new Logger(PropertyPublishEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPropertyPublishedEmail(
    input: PropertyPublishedEmailInput,
  ): Promise<{ sent: boolean; providerRef?: string; error?: string }> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from =
      this.config.get<string>('PROPERTY_PUBLISH_EMAIL_FROM') ||
      this.config.get<string>('EMAIL_FROM') ||
      'Localicer <somos@localicer.com>';

    const subject = `Anuncio publicado: ${input.propertyTitle}`;
    const text =
      `Hola,\n\n` +
      `Tu inmueble ya está publicado en Localicer.\n\n` +
      `Título: ${input.propertyTitle}\n` +
      `Enlace: ${input.propertyUrl}\n` +
      (input.callId ? `Ref. llamada: ${input.callId}\n` : '') +
      `\nUn saludo,\nEquipo Localicer`;

    const html = `
      <p>Hola,</p>
      <p>Tu inmueble ya está publicado en Localicer.</p>
      <p><strong>${input.propertyTitle}</strong></p>
      <p><a href="${input.propertyUrl}">Ver anuncio</a></p>
      ${input.callId ? `<p><em>Ref. llamada: ${input.callId}</em></p>` : ''}
      <p>Un saludo,<br/>Equipo Localicer</p>
    `;

    if (!apiKey) {
      const mockId = `mock_publish_email_${Date.now()}`;
      this.logger.warn(
        `[MOCK Resend publish] RESEND_API_KEY ausente\n` +
          `  from: ${from}\n  to: ${input.to}\n  subject: ${subject}\n  url: ${input.propertyUrl}`,
      );
      return { sent: true, providerRef: mockId };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject,
          text,
          html,
          tags: [
            { name: 'type', value: 'property_published' },
            ...(input.callId
              ? [{ name: 'call_id', value: String(input.callId) }]
              : []),
          ],
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };

      if (!response.ok) {
        const error = data.message || `Resend HTTP ${response.status}`;
        this.logger.error(`Property publish email failed: ${error}`);
        return { sent: false, error };
      }

      this.logger.log(
        `Property publish email sent id=${data.id} to=${input.to} url=${input.propertyUrl}`,
      );
      return { sent: true, providerRef: data.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Property publish email error: ${message}`);
      return { sent: false, error: message };
    }
  }
}
