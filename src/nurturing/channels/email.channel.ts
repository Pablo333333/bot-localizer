import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '../enums';
import { renderTemplate } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * Email vía Resend. Sin RESEND_API_KEY → modo mock (dev): log + éxito simulado.
 * Vars: RESEND_API_KEY, EMAIL_FROM
 */
@Injectable()
export class EmailChannel implements NurturingChannel {
  readonly channel = Channel.EMAIL;
  private readonly logger = new Logger(EmailChannel.name);

  constructor(private readonly config: ConfigService) {}

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (!payload.email) {
      return { success: false, error: 'Lead has no email' };
    }

    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from =
      this.config.get<string>('EMAIL_FROM') ||
      this.config.get<string>('RESEND_FROM') ||
      'Localicer <somos@localicer.com>';

    const subjectTemplate =
      (payload.templatePayload?.subject as string | undefined) ||
      'Seguimiento — Localicer';
    const bodyTemplate =
      (payload.templatePayload?.body as string | undefined) ||
      'Hola {{name}}, te escribimos para dar seguimiento a tu consulta.';

    const vars = {
      name: payload.name || '',
      phone: payload.phone,
      email: payload.email,
    };

    const subject = renderTemplate(subjectTemplate, vars);
    const text = renderTemplate(bodyTemplate, vars);
    const html =
      (payload.templatePayload?.html as string | undefined) ||
      `<p>${text.replace(/\n/g, '<br/>')}</p>`;

    if (!apiKey) {
      const mockId = `mock_email_${Date.now()}`;
      this.logger.warn(
        `[MOCK EMAIL] RESEND_API_KEY ausente — simulado OK\n` +
          `  from: ${from}\n` +
          `  to: ${payload.email}\n` +
          `  subject: ${subject}\n` +
          `  body: ${text}\n` +
          `  leadId: ${payload.leadId}\n` +
          `  stepRunId: ${payload.stepRunId}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
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
          to: [payload.email],
          subject,
          text,
          html,
          tags: [
            { name: 'lead_id', value: payload.leadId },
            { name: 'step_run_id', value: payload.stepRunId },
            { name: 'template', value: payload.templateKey },
          ],
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };

      if (!response.ok) {
        const error =
          data.message || data.name || `Resend HTTP ${response.status}`;
        this.logger.error(`Email send failed lead=${payload.leadId}: ${error}`);
        return { success: false, error };
      }

      this.logger.log(
        `Email sent lead=${payload.leadId} id=${data.id} to=${payload.email}`,
      );
      return { success: true, providerRef: data.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Email send failed lead=${payload.leadId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
