import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import { renderTemplate, toWhatsAppAddress } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

@Injectable()
export class WhatsappChannel implements NurturingChannel {
  readonly channel = Channel.WHATSAPP;
  private readonly logger = new Logger(WhatsappChannel.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(private readonly config: ConfigService) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_WHATSAPP_NUMBER');
    this.client = sid && token ? twilio(sid, token) : null;
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const bookingLink =
      (payload.templatePayload?.booking_link as string | undefined) ||
      this.config.get<string>('BOOKING_LINK') ||
      this.config.get<string>('CALENDAR_BOOKING_URL') ||
      'https://www.localicer.com/agendar';

    const bodyTemplate =
      (payload.templatePayload?.body as string | undefined) ||
      'Hola {{name}}, no hemos podido hablar. Agenda tu visita aquí: {{booking_link}} — Localicer';

    const body = renderTemplate(bodyTemplate, {
      name: payload.name || 'hola',
      phone: payload.phone,
      email: payload.email,
      booking_link: bookingLink,
    });

    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';

    if (forceMock || !this.client || !this.fromNumber) {
      const to = toWhatsAppAddress(payload.phone);
      const mockId = `mock_wa_${Date.now()}`;
      this.logger.warn(
        `[MOCK WhatsApp] ${forceMock ? 'NURTURING_MOCK_CHANNELS=true' : 'Twilio no configurado'} — simulado OK\n` +
          `  to: ${to}\n` +
          `  body: ${body}\n` +
          `  leadId: ${payload.leadId}\n` +
          `  stepRunId: ${payload.stepRunId}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    try {
      const to = toWhatsAppAddress(payload.phone);
      const message = await this.client.messages.create({
        from: this.fromNumber,
        to,
        body,
      });

      this.logger.log(
        `WhatsApp sent lead=${payload.leadId} sid=${message.sid} to=${to}`,
      );
      return { success: true, providerRef: message.sid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`WhatsApp send failed lead=${payload.leadId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
