import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import { formatE164Spain, renderTemplate } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * Fallback final SMS (Twilio). Preparado según Toni.
 * Vars: TWILIO_* — usa el mismo Account SID; from = TWILIO_SMS_FROM o número sin whatsapp:
 */
@Injectable()
export class SmsChannel implements NurturingChannel {
  readonly channel = Channel.SMS;
  private readonly logger = new Logger(SmsChannel.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(private readonly config: ConfigService) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber =
      this.config.get<string>('TWILIO_SMS_FROM') ||
      this.config.get<string>('TWILIO_FROM_NUMBER');
    this.client = sid && token ? twilio(sid, token) : null;
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const bodyTemplate =
      (payload.templatePayload?.body as string | undefined) ||
      'Hola {{name}}, desde Localicer te escribimos por SMS. Agenda aquí: {{booking_link}}';

    const bookingLink =
      (payload.templatePayload?.booking_link as string | undefined) ||
      this.config.get<string>('BOOKING_LINK') ||
      this.config.get<string>('CALENDAR_BOOKING_URL') ||
      'https://www.localicer.com/agendar';

    const body = renderTemplate(bodyTemplate, {
      name: payload.name || '',
      phone: payload.phone,
      booking_link: bookingLink,
    });

    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';

    if (forceMock || !this.client || !this.fromNumber) {
      const mockId = `mock_sms_${Date.now()}`;
      this.logger.warn(
        `[MOCK SMS] ${forceMock ? 'NURTURING_MOCK_CHANNELS=true' : 'TWILIO_SMS_FROM no configurado'} — simulado OK\n` +
          `  to: ${formatE164Spain(payload.phone)}\n` +
          `  body: ${body}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    try {
      const message = await this.client.messages.create({
        from: this.fromNumber,
        to: formatE164Spain(payload.phone),
        body,
      });
      this.logger.log(`SMS sent lead=${payload.leadId} sid=${message.sid}`);
      return { success: true, providerRef: message.sid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMS send failed lead=${payload.leadId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
